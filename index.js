const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Paths
const DATA_DIR = path.join(__dirname, 'data');
const REPORTS_FILE = path.join(DATA_DIR, 'reports.json');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const EQUIPMENTS_FILE = path.join(DATA_DIR, 'equipments.json');
const PLANS_FILE = path.join(DATA_DIR, 'plans.json');
const COUNTER_FILE = path.join(DATA_DIR, 'counter.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Ensure data folder exists
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {}

// Helpers for thread-safe JSON operations
function readJson(filePath, defaultValue = []) {
  try {
    if (!fs.existsSync(filePath)) {
      try {
        fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf8');
      } catch (e) {}
      return defaultValue;
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
    return defaultValue;
  }
}

function writeJson(filePath, data) {
  try {
    const content = JSON.stringify(data, null, 2);
    try {
      const tempPath = `${filePath}.tmp`;
      fs.writeFileSync(tempPath, content, 'utf8');
      fs.renameSync(tempPath, filePath);
    } catch (renameErr) {
      // Fallback para evitar EPERM por sincronización en segundo plano de OneDrive en Windows
      fs.writeFileSync(filePath, content, 'utf8');
    }
    return true;
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);
    return false;
  }
}

// Atomic report number generator: REP-YYYY-XXXX (Strictly correlative)
function getNextReportNumber(peekOnly = false) {
  const currentYear = new Date().getFullYear();
  const counter = readJson(COUNTER_FILE, { prefix: 'REP', year: currentYear, lastSequence: 0 });
  
  if (counter.year !== currentYear) {
    counter.year = currentYear;
    counter.lastSequence = 0;
  }

  // Scan ALL reports in reports.json to guarantee no duplicate sequence
  const reports = readJson(REPORTS_FILE, []);
  let maxSeq = counter.lastSequence || 0;

  reports.forEach(r => {
    if (r.reportNumber) {
      const match = String(r.reportNumber).match(new RegExp(`^${counter.prefix}-${currentYear}-(\\d+)$`));
      if (match) {
        const seq = parseInt(match[1], 10);
        if (seq > maxSeq) {
          maxSeq = seq;
        }
      }
    }
  });

  const nextSeq = maxSeq + 1;
  const formattedSeq = String(nextSeq).padStart(4, '0');
  const numberStr = `${counter.prefix}-${currentYear}-${formattedSeq}`;

  if (!peekOnly) {
    counter.lastSequence = nextSeq;
    writeJson(COUNTER_FILE, counter);
  }

  return numberStr;
}

// --- API ROUTES ---

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Next report number preview
app.get('/api/next-report-number', (req, res) => {
  const peek = req.query.peek === 'true';
  const number = getNextReportNumber(peek);
  res.json({ reportNumber: number });
});

// --- Reports Endpoints ---
app.get('/api/reports', (req, res) => {
  const reports = readJson(REPORTS_FILE, []);
  // Return light list (omitting massive base64 photos for fast list loading if query param summary=true)
  if (req.query.summary === 'true') {
    const summaries = reports.map(r => ({
      id: r.id,
      reportNumber: r.reportNumber,
      date: r.date,
      client: r.client,
      model: r.model,
      serialNumber: r.serialNumber,
      technician: r.technician,
      maintenanceType: r.maintenanceType,
      status: r.status,
      updatedAt: r.updatedAt,
      photosCount: (r.photos || []).length
    }));
    return res.json(summaries);
  }
  res.json(reports);
});

app.get('/api/reports/:id', (req, res) => {
  const reports = readJson(REPORTS_FILE, []);
  const report = reports.find(r => r.id === req.params.id || r.reportNumber === req.params.id);
  if (!report) {
    return res.status(404).json({ error: 'Reporte no encontrado' });
  }
  res.json(report);
});

app.post('/api/reports', (req, res) => {
  try {
    const reports = readJson(REPORTS_FILE, []);
    const reportData = req.body;

    // Check or generate unique reportNumber
    let reportNumber = reportData.reportNumber;
    const exists = reports.find(r => r.reportNumber === reportNumber && r.id !== reportData.id);

    if (!reportNumber || reportNumber === 'AUTO' || reportNumber.trim() === '' || exists) {
      reportNumber = getNextReportNumber(false);
    } else {
      // Ensure counter sequence is at least this number
      const currentYear = new Date().getFullYear();
      const match = String(reportNumber).match(new RegExp(`^REP-${currentYear}-(\\d+)$`));
      if (match) {
        const seq = parseInt(match[1], 10);
        const counter = readJson(COUNTER_FILE, { prefix: 'REP', year: currentYear, lastSequence: 0 });
        if (seq > counter.lastSequence) {
          counter.lastSequence = seq;
          writeJson(COUNTER_FILE, counter);
        }
      }
    }

    const newReport = {
      ...reportData,
      id: reportData.id || `rep-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      reportNumber: reportNumber,
      status: reportData.status || 'Borrador', // 'Borrador' | 'Pendiente de revisión' | 'Finalizado'
      createdAt: reportData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    reports.unshift(newReport);
    writeJson(REPORTS_FILE, reports);

    // Auto-sync to Google Sheets in background if finalized
    let horometerUpdate = null;
    if (newReport.status === 'Finalizado') {
      syncReportToGoogleSheets(newReport);
      horometerUpdate = applyReportToEquipmentHorometer(newReport);
    }

    res.status(201).json({ ...newReport, horometerUpdate });
  } catch (err) {
    console.error('Error saving report:', err);
    res.status(500).json({ error: 'Error interno al guardar el reporte' });
  }
});

app.put('/api/reports/:id', (req, res) => {
  try {
    const reports = readJson(REPORTS_FILE, []);
    const index = reports.findIndex(r => r.id === req.params.id || r.reportNumber === req.params.id);

    let updated;
    if (index === -1) {
      // UPSERT: Si el reporte no se encontró en reports.json (ej. por borrado previo o desincronización de borrador),
      // lo creamos como nuevo reporte para garantizar que NUNCA se pierda el trabajo del usuario.
      const reportData = req.body;
      let validReportNumber = reportData.reportNumber || req.params.id;
      if (!validReportNumber || validReportNumber === 'AUTO' || validReportNumber.trim() === '') {
        validReportNumber = getNextReportNumber(false);
      }
      updated = {
        ...reportData,
        id: req.params.id || `rep-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        reportNumber: validReportNumber,
        status: reportData.status || 'Borrador',
        createdAt: reportData.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      reports.unshift(updated);
    } else {
      const current = reports[index];
      let validReportNumber = current.reportNumber;
      if (!validReportNumber || validReportNumber === 'AUTO' || validReportNumber.trim() === '') {
        validReportNumber = getNextReportNumber(false);
      }

      updated = {
        ...current,
        ...req.body,
        id: current.id, // Immutable ID
        reportNumber: validReportNumber, // Immutable once assigned
        updatedAt: new Date().toISOString()
      };
      reports[index] = updated;
    }

    writeJson(REPORTS_FILE, reports);

    // Auto-sync to Google Sheets in background if finalized
    let horometerUpdate = null;
    if (updated.status === 'Finalizado') {
      syncReportToGoogleSheets(updated);
      horometerUpdate = applyReportToEquipmentHorometer(updated);
    }

    res.json({ ...updated, horometerUpdate });
  } catch (err) {
    console.error('Error updating report:', err);
    res.status(500).json({ error: 'Error al actualizar el reporte' });
  }
});

app.delete('/api/reports/:id', async (req, res) => {
  try {
    const rawId = req.params.id ? String(req.params.id).trim() : '';
    if (!rawId) {
      return res.status(400).json({ error: 'ID o número de reporte inválido o vacío' });
    }

    let reports = readJson(REPORTS_FILE, []);
    const targetIdLower = rawId.toLowerCase();

    const reportToDelete = reports.find(r => 
      (r.id && String(r.id).trim().toLowerCase() === targetIdLower) ||
      (r.reportNumber && String(r.reportNumber).trim().toLowerCase() === targetIdLower)
    );

    if (!reportToDelete) {
      return res.status(404).json({ error: 'Reporte no encontrado en el sistema.' });
    }

    reports = reports.filter(r => r !== reportToDelete);
    writeJson(REPORTS_FILE, reports);

    // Call Google Sheets delete webhook if configured (non-blocking)
    deleteReportFromGoogleSheets(reportToDelete).catch(err => {
      console.warn('[Google Sheets Sync] Aviso al eliminar:', err.message);
    });

    // Desvincular de los horómetros del equipo y recalcular
    try {
      removeReportFromEquipmentHorometer(reportToDelete);
    } catch (eHoro) {
      console.warn('[Horometers] Aviso al desvincular reporte de equipo:', eHoro.message);
    }

    console.log(`[Reports] Reporte ${reportToDelete.reportNumber || reportToDelete.id} eliminado permanentemente.`);
    res.json({
      success: true,
      message: 'Reporte eliminado exitosamente',
      id: reportToDelete.id,
      reportNumber: reportToDelete.reportNumber
    });
  } catch (err) {
    console.error('Error deleting report:', err);
    res.status(500).json({ error: 'Error interno al eliminar el reporte' });
  }
});

// PDF upload & download endpoints
const PDFS_DIR = path.join(DATA_DIR, 'pdfs');
if (!fs.existsSync(PDFS_DIR)) {
  fs.mkdirSync(PDFS_DIR, { recursive: true });
}

// Generador de nombre estandarizado de archivo PDF:
// REP-(CLIENTE)-(MODELO DE COMPRESOR)-(TIPO DE MANTENIMIENTO)-(FECHA)
function generateReportPdfFileName(report) {
  if (!report) return 'REP-REPORTE.pdf';

  const sanitize = (str) => {
    if (!str) return '';
    return String(str)
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/[\r\n\t]/g, ' ')
      .replace(/[—–]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const client = sanitize(report.client) || 'CLIENTE';
  const model = sanitize(report.model) || 'MODELO';
  const maint = sanitize(report.maintenanceType || report.serviceType) || 'MANTENIMIENTO';

  let dateStr = '';
  if (report.date) {
    const raw = String(report.date).split('T')[0].trim();
    const parts = raw.split('-');
    if (parts.length === 3) {
      dateStr = parts.join('-');
    } else {
      dateStr = sanitize(report.date).replace(/[\/]/g, '-');
    }
  }
  if (!dateStr) {
    dateStr = new Date().toISOString().split('T')[0];
  }

  return `REP-${client}-${model}-${maint}-${dateStr}.pdf`;
}

// Upload generated PDF to server & Google Drive (Carpeta: PDF_REPORTES2027)
app.post('/api/reports/:id/pdf', async (req, res) => {
  try {
    const { pdfBase64, fileName: requestedFileName } = req.body;
    if (!pdfBase64) {
      return res.status(400).json({ error: 'No se envió contenido del PDF' });
    }

    const cleanBase64 = pdfBase64.includes('base64,') ? pdfBase64.split('base64,')[1].trim() : pdfBase64.trim();
    const buffer = Buffer.from(cleanBase64, 'base64');
    const filePath = path.join(PDFS_DIR, `${req.params.id}.pdf`);

    // Intentar guardar copia local en disco si es escribible (o /tmp si es Vercel serverless)
    try {
      if (!fs.existsSync(PDFS_DIR)) {
        fs.mkdirSync(PDFS_DIR, { recursive: true });
      }
      fs.writeFileSync(filePath, buffer);
    } catch (fsErr) {
      console.warn('[Storage] Entorno serverless/solo lectura (Vercel). Guardando en /tmp:', fsErr.message);
      try {
        fs.writeFileSync(path.join('/tmp', `${req.params.id}.pdf`), buffer);
      } catch (tmpErr) {}
    }

    const reports = readJson(REPORTS_FILE, []);
    const reportIndex = reports.findIndex(r => r.id === req.params.id || r.reportNumber === req.params.id);
    let report = reportIndex !== -1 ? reports[reportIndex] : null;

    const fileName = requestedFileName || generateReportPdfFileName(report);

    let driveResult = null;
    const defaultWebhook = 'https://script.google.com/macros/s/AKfycbynhuCRqkjdVzK0sEeQCdbeHMFwcMj6PLqDW6Cme2wOcNRo4ZuaoTEe7a_54GZG2L6U/exec';
    const settings = readJson(SETTINGS_FILE, { googleSheetsWebhookUrl: defaultWebhook, autoSyncSheets: true });
    const webhookUrl = (process.env.GOOGLE_SHEETS_WEBHOOK_URL || settings.googleSheetsWebhookUrl || defaultWebhook).trim();

    if (webhookUrl) {
      try {
        const repNum = report && report.reportNumber ? report.reportNumber : req.params.id;

        console.log(`[Google Drive] Subiendo PDF "${fileName}" a carpeta PDF_REPORTES2027...`);
        const driveRes = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'upload_pdf_drive',
            folderName: 'PDF_REPORTES2027',
            reportId: req.params.id,
            reportNumber: repNum,
            fileName: fileName,
            pdfBase64: cleanBase64
          })
        });
        const driveData = await driveRes.json();
        if (driveData && driveData.status === 'success') {
          driveResult = driveData;
          console.log(`[Google Drive] ¡Subida exitosa a Drive! URL: ${driveData.driveViewUrl}`);
          if (report) {
            report.pdfDriveUrl = driveData.driveViewUrl;
            report.pdfDriveDownloadUrl = driveData.driveDownloadUrl;
            reports[reportIndex] = report;
            writeJson(REPORTS_FILE, reports);
          }
        } else {
          console.warn('[Google Drive] Respuesta no exitosa de Apps Script:', driveData);
        }
      } catch (eDrive) {
        console.warn('[Google Drive Sync] Aviso: no se pudo sincronizar a Google Drive:', eDrive.message);
      }
    }

    res.json({
      message: driveResult ? 'PDF guardado en servidor y Google Drive' : 'PDF procesado exitosamente',
      fileName: fileName,
      downloadUrl: `/api/reports/${req.params.id}/pdf`,
      driveUrl: driveResult?.driveViewUrl || null,
      driveDownloadUrl: driveResult?.driveDownloadUrl || null
    });
  } catch (err) {
    console.error('Error guardando PDF:', err);
    res.status(500).json({ error: 'Error al procesar archivo PDF: ' + err.message });
  }
});

// Direct HTTP attachment download (100% reliable in all browsers)
app.get('/api/reports/:id/pdf', (req, res) => {
  const filePath = path.join(PDFS_DIR, `${req.params.id}.pdf`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Archivo PDF no encontrado en el servidor. Debe generarlo previamente.');
  }

  const reports = readJson(REPORTS_FILE, []);
  const report = reports.find(r => r.id === req.params.id || r.reportNumber === req.params.id);
  const downloadName = generateReportPdfFileName(report);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
  res.sendFile(filePath);
});

// Inline view for modal preview
app.get('/api/reports/:id/pdf-view', (req, res) => {
  const filePath = path.join(PDFS_DIR, `${req.params.id}.pdf`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Archivo PDF no encontrado en el servidor.');
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline');
  res.sendFile(filePath);
});

// =========================================================================
// PRODUCTION CATALOG LOGIC (DEMO DATA RETIRED FOR PRODUCTION USE)
// =========================================================================
const DEMO_CLIENTS = [];

const DEMO_EQUIPMENTS = [];

// Helper to initialize catalog data
// Helper to initialize catalog data, sync existing clients & demo data
function initCatalogData() {
  let clients = readJson(CLIENTS_FILE, []);
  let equipments = readJson(EQUIPMENTS_FILE, []);

  // 1. Ensure non-demo existing equipments have client entries and apiCodes
  let clientsModified = false;
  let equipmentsModified = false;

  equipments.forEach(eq => {
    if (!eq.status) {
      eq.status = 'Activo';
      equipmentsModified = true;
    }
    if (eq.active === undefined) {
      eq.active = eq.status !== 'Inactivo';
      equipmentsModified = true;
    }
    if (!eq.apiCode) {
      eq.apiCode = `API-${(eq.id || 'EQ').toUpperCase()}`;
      equipmentsModified = true;
    }
    if (!eq.isDemo) {
      eq.isDemo = false;
    }

    // Ensure client exists in clients.json
    if (eq.client) {
      let clientObj = clients.find(c => c.name.toLowerCase() === eq.client.toLowerCase());
      if (!clientObj) {
        clientObj = {
          id: `cli-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          name: eq.client,
          address: eq.address || '',
          contact: '',
          notes: 'Cliente registrado desde catálogo base.',
          isDemo: false
        };
        clients.push(clientObj);
        clientsModified = true;
      }
      if (!eq.clientId || eq.clientId !== clientObj.id) {
        eq.clientId = clientObj.id;
        equipmentsModified = true;
      }
    }
  });

  if (clientsModified) writeJson(CLIENTS_FILE, clients);
  if (equipmentsModified) writeJson(EQUIPMENTS_FILE, equipments);
}

// Run initialization once on startup
initCatalogData();

// --- CLIENTS ENDPOINTS ---
app.get('/api/clients', (req, res) => {
  const clients = readJson(CLIENTS_FILE, []);
  const equipments = readJson(EQUIPMENTS_FILE, []);

  const clientsWithStats = clients.map(c => {
    const matchedEquipments = equipments.filter(e => e.clientId === c.id || e.client?.toLowerCase() === c.name.toLowerCase());
    const activeCount = matchedEquipments.filter(e => e.status !== 'Inactivo' && e.active !== false).length;
    return {
      ...c,
      equipmentCount: matchedEquipments.length,
      activeEquipmentCount: activeCount
    };
  });

  res.json(clientsWithStats);
});

app.post('/api/clients', (req, res) => {
  const clients = readJson(CLIENTS_FILE, []);
  const name = (req.body.name || '').trim();

  if (!name) {
    return res.status(400).json({ error: 'El nombre del cliente es requerido.' });
  }

  // Prevent duplicate names
  const existing = clients.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    return res.status(400).json({ error: `Ya existe un cliente con el nombre "${name}".`, client: existing });
  }

  const newClient = {
    id: req.body.id || `cli-${Date.now()}`,
    name,
    address: req.body.address || '',
    contact: req.body.contact || '',
    notes: req.body.notes || '',
    isDemo: !!req.body.isDemo,
    createdAt: new Date().toISOString()
  };

  clients.push(newClient);
  writeJson(CLIENTS_FILE, clients);
  res.status(201).json(newClient);
});

app.put('/api/clients/:id', (req, res) => {
  const clients = readJson(CLIENTS_FILE, []);
  const idx = clients.findIndex(c => c.id === req.params.id);

  if (idx === -1) {
    return res.status(404).json({ error: 'Cliente no encontrado.' });
  }

  const oldName = clients[idx].name;
  const newName = (req.body.name || oldName).trim();

  // Check duplicate if name changed
  if (newName.toLowerCase() !== oldName.toLowerCase()) {
    const duplicate = clients.find(c => c.id !== req.params.id && c.name.toLowerCase() === newName.toLowerCase());
    if (duplicate) {
      return res.status(400).json({ error: `Ya existe otro cliente con el nombre "${newName}".` });
    }
  }

  clients[idx] = {
    ...clients[idx],
    ...req.body,
    name: newName,
    id: clients[idx].id
  };
  writeJson(CLIENTS_FILE, clients);

  // Sync client name in associated equipments
  if (newName !== oldName) {
    const equipments = readJson(EQUIPMENTS_FILE, []);
    let eqModified = false;
    equipments.forEach(eq => {
      if (eq.clientId === req.params.id || eq.client === oldName) {
        eq.client = newName;
        eq.clientId = req.params.id;
        eqModified = true;
      }
    });
    if (eqModified) writeJson(EQUIPMENTS_FILE, equipments);
  }

  res.json(clients[idx]);
});

app.delete('/api/clients/:id', (req, res) => {
  let clients = readJson(CLIENTS_FILE, []);
  const clientToDelete = clients.find(c => c.id === req.params.id);

  if (!clientToDelete) {
    return res.status(404).json({ error: 'Cliente no encontrado.' });
  }

  clients = clients.filter(c => c.id !== req.params.id);
  writeJson(CLIENTS_FILE, clients);

  // Also remove or disassociate its equipments if requested
  const removeEquipments = req.query.removeEquipments === 'true';
  let equipments = readJson(EQUIPMENTS_FILE, []);
  if (removeEquipments) {
    equipments = equipments.filter(e => e.clientId !== req.params.id && e.client !== clientToDelete.name);
    writeJson(EQUIPMENTS_FILE, equipments);
  }

  res.json({ message: 'Cliente eliminado exitosamente.' });
});

// --- EQUIPMENTS ENDPOINTS ---
app.get('/api/equipments', (req, res) => {
  let equipments = readJson(EQUIPMENTS_FILE, []);
  const { clientId, client, status, isDemo } = req.query;

  if (clientId) {
    equipments = equipments.filter(e => e.clientId === clientId);
  } else if (client) {
    equipments = equipments.filter(e => (e.client || '').toLowerCase() === client.toLowerCase());
  }

  if (status) {
    equipments = equipments.filter(e => (e.status || 'Activo').toLowerCase() === status.toLowerCase());
  }

  if (isDemo !== undefined) {
    const demoBool = isDemo === 'true';
    equipments = equipments.filter(e => !!e.isDemo === demoBool);
  }

  res.json(equipments);
});

app.get('/api/equipments/:id', (req, res) => {
  const equipments = readJson(EQUIPMENTS_FILE, []);
  const eq = equipments.find(e => e.id === req.params.id || e.apiCode === req.params.id);
  if (!eq) {
    return res.status(404).json({ error: 'Equipo no encontrado.' });
  }
  res.json(eq);
});

// Get reports history specifically for this machine
app.get('/api/equipments/:id/reports', (req, res) => {
  const equipments = readJson(EQUIPMENTS_FILE, []);
  const eq = equipments.find(e => e.id === req.params.id || e.apiCode === req.params.id);
  if (!eq) {
    return res.status(404).json({ error: 'Equipo no encontrado.' });
  }

  const reports = readJson(REPORTS_FILE, []);
  const matchedReports = reports.filter(r => {
    const matchId = r.equipmentId && r.equipmentId === eq.id;
    const matchApi = r.apiCode && r.apiCode === eq.apiCode;
    const matchSerial = r.serialNumber && eq.serialNumber && r.serialNumber.trim().toLowerCase() === eq.serialNumber.trim().toLowerCase();
    const matchClientModel = r.client && eq.client && r.model && eq.model &&
      r.client.trim().toLowerCase() === eq.client.trim().toLowerCase() &&
      r.model.trim().toLowerCase() === eq.model.trim().toLowerCase();
    return matchId || matchApi || matchSerial || matchClientModel;
  });

  res.json(matchedReports);
});

app.post('/api/equipments', (req, res) => {
  const equipments = readJson(EQUIPMENTS_FILE, []);
  const clients = readJson(CLIENTS_FILE, []);

  const clientName = (req.body.client || '').trim();
  const model = (req.body.model || '').trim();
  let apiCode = (req.body.apiCode || req.body.serialNumber || '').trim();
  const serialNumber = (req.body.serialNumber || req.body.apiCode || '').trim();

  if (!clientName || !model || (!serialNumber && !apiCode)) {
    return res.status(400).json({ error: 'Cliente, modelo y API / ID Máquina son campos obligatorios.' });
  }

  // Find or link clientId
  let clientObj = clients.find(c => (req.body.clientId && c.id === req.body.clientId) || c.name.toLowerCase() === clientName.toLowerCase());
  if (!clientObj) {
    // Automatically register client if not existing
    clientObj = {
      id: `cli-${Date.now()}`,
      name: clientName,
      address: req.body.address || '',
      contact: '',
      notes: '',
      isDemo: !!req.body.isDemo
    };
    clients.push(clientObj);
    writeJson(CLIENTS_FILE, clients);
  }

  // Generate API Code if not provided
  if (!apiCode) {
    const clientPrefix = clientName.substr(0, 3).toUpperCase().replace(/[^A-Z]/g, 'CLI');
    const count = equipments.filter(e => e.clientId === clientObj.id).length + 1;
    apiCode = `EQ-${clientPrefix}-${String(count).padStart(3, '0')}`;
  } else {
    // Check uniqueness of apiCode
    const duplicate = equipments.find(e => e.apiCode && e.apiCode.toLowerCase() === apiCode.toLowerCase());
    if (duplicate) {
      return res.status(400).json({ error: `El código API/identificador "${apiCode}" ya está en uso por otro equipo.` });
    }
  }

  const newEquipment = {
    id: req.body.id || `eq-${Date.now()}`,
    clientId: clientObj.id,
    client: clientObj.name,
    address: req.body.address || clientObj.address || '',
    manufacturer: req.body.manufacturer || 'Atlas Copco',
    model,
    serialNumber,
    apiCode,
    controller: req.body.controller || 'Pendiente de completar',
    pressure: req.body.pressure || 'Pendiente de completar',
    airflow: req.body.airflow || 'Pendiente de completar',
    oilType: req.body.oilType || 'Pendiente de completar',
    hourMeter: String(req.body.hourMeter !== undefined ? req.body.hourMeter : (req.body.hours !== undefined ? req.body.hours : '0')),
    hours: Number(req.body.hours !== undefined ? req.body.hours : (req.body.hourMeter !== undefined ? req.body.hourMeter : 0)),
    maintenanceCycle: req.body.maintenanceCycle || req.body.cycleType || 'ciclo_2000',
    cycleType: req.body.cycleType || req.body.maintenanceCycle || 'ciclo_2000',
    alertThresholdHours: Number(req.body.alertThresholdHours) || 200,
    monthlyAverageHours: req.body.monthlyAverageHours || null,
    location: req.body.location || 'Sala de Compresores',
    status: req.body.status || 'Activo',
    active: req.body.status !== 'Inactivo',
    notes: req.body.notes || '',
    isDemo: !!req.body.isDemo,
    lastMaintenance: req.body.lastMaintenance || null,
    nextMaintenance: req.body.nextMaintenance || null,
    readingsHistory: Array.isArray(req.body.readingsHistory) ? req.body.readingsHistory : [],
    createdAt: new Date().toISOString()
  };

  if (newEquipment.lastMaintenance && !newEquipment.nextMaintenance) {
    const seq = determineNextMaintenancePlan(newEquipment, newEquipment.lastMaintenance);
    newEquipment.nextMaintenance = {
      milestoneHours: seq.nextMilestoneHours,
      plan: seq.nextPlan
    };
  }

  equipments.push(newEquipment);
  writeJson(EQUIPMENTS_FILE, equipments);
  res.status(201).json(newEquipment);
});

app.put('/api/equipments/:id', (req, res) => {
  const equipments = readJson(EQUIPMENTS_FILE, []);
  const idx = equipments.findIndex(e => e.id === req.params.id);

  if (idx === -1) {
    return res.status(404).json({ error: 'Equipo no encontrado.' });
  }

  // Check unique apiCode if changed
  if (req.body.apiCode && req.body.apiCode !== equipments[idx].apiCode) {
    const duplicate = equipments.find(e => e.id !== req.params.id && e.apiCode && e.apiCode.toLowerCase() === req.body.apiCode.trim().toLowerCase());
    if (duplicate) {
      return res.status(400).json({ error: `El código API "${req.body.apiCode}" ya pertenece a otra máquina.` });
    }
  }

  const updatedStatus = req.body.status || equipments[idx].status || 'Activo';
  const updatedActive = req.body.active !== undefined ? req.body.active : updatedStatus !== 'Inactivo';

  equipments[idx] = {
    ...equipments[idx],
    ...req.body,
    status: updatedStatus,
    active: updatedActive,
    id: equipments[idx].id,
    updatedAt: new Date().toISOString()
  };

  writeJson(EQUIPMENTS_FILE, equipments);
  res.json(equipments[idx]);
});

// Toggle equipment active/inactive status without deleting history
app.patch('/api/equipments/:id/status', (req, res) => {
  const equipments = readJson(EQUIPMENTS_FILE, []);
  const idx = equipments.findIndex(e => e.id === req.params.id);

  if (idx === -1) {
    return res.status(404).json({ error: 'Equipo no encontrado.' });
  }

  const newStatus = req.body.status || (equipments[idx].status === 'Activo' ? 'Inactivo' : 'Activo');
  equipments[idx].status = newStatus;
  equipments[idx].active = newStatus === 'Activo';
  equipments[idx].updatedAt = new Date().toISOString();

  writeJson(EQUIPMENTS_FILE, equipments);
  res.json({ message: `Equipo marcado como ${newStatus}`, equipment: equipments[idx] });
});

app.delete('/api/equipments/:id', (req, res) => {
  let equipments = readJson(EQUIPMENTS_FILE, []);
  const eq = equipments.find(e => e.id === req.params.id);

  if (!eq) {
    return res.status(404).json({ error: 'Equipo no encontrado.' });
  }

  equipments = equipments.filter(e => e.id !== req.params.id);
  writeJson(EQUIPMENTS_FILE, equipments);
  res.json({ message: 'Equipo eliminado exitosamente.' });
});

// Endpoint para borrar/restablecer datos de horómetro de un equipo (dejándolo en "Pendiente de datos")
app.delete('/api/equipments/:id/horometer', (req, res) => {
  try {
    const equipments = readJson(EQUIPMENTS_FILE, []);
    const eq = equipments.find(e => e.id === req.params.id);

    if (!eq) {
      return res.status(404).json({ error: 'Equipo no encontrado en el sistema.' });
    }

    eq.readingsHistory = [];
    eq.lastMaintenance = null;
    eq.nextMaintenance = null;
    eq.lastReadingDate = null;
    eq.hourMeter = null;
    eq.hours = null;
    eq.updatedAt = new Date().toISOString();

    writeJson(EQUIPMENTS_FILE, equipments);
    console.log(`[Horometers] Horómetro del equipo ${eq.model} (${eq.id}) restablecido a estado pendiente de datos.`);
    res.json({ success: true, message: 'Horómetro restablecido exitosamente a Pendiente de Datos.' });
  } catch (err) {
    res.status(500).json({ error: 'Error al restablecer horómetro: ' + err.message });
  }
});

// =========================================================================
// MÓDULO DE HORÓMETROS Y PRÓXIMOS MANTENIMIENTOS (INDUSTRAC S.A.C.)
// =========================================================================

function addCalendarMonths(dateStr, monthsToAdd = 3) {
  if (!dateStr) return null;
  const parts = String(dateStr).split('T')[0].split('-');
  if (parts.length < 3) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // 0-indexed
  const day = parseInt(parts[2], 10);

  const targetMonthIndex = month + monthsToAdd;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;

  const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const targetDay = Math.min(day, daysInTargetMonth);

  const pad = n => String(n).padStart(2, '0');
  return `${targetYear}-${pad(targetMonth + 1)}-${pad(targetDay)}`;
}

function formatMaintenanceTypeLabel(planOrHours) {
  if (!planOrHours) return null;
  const s = String(planOrHours).toLowerCase();
  if (s.includes('12000') || s.includes('12,000') || s === '12000') return '12,000 h';
  if (s.includes('8000') || s.includes('8,000') || s === '8000') return '8,000 h';
  if (s.includes('6000') || s.includes('6,000') || s === '6000') return '6,000 h';
  if (s.includes('4000') || s.includes('4,000') || s === '4000') return '4,000 h';
  if (s.includes('3000') || s.includes('3,000') || s === '3000') return '3,000 h';
  if (s.includes('2000') || s.includes('2,000') || s === '2000') return '2,000 h';
  return String(planOrHours);
}

function getPlanForMilestone(milestoneHours, cycle = 'ciclo_2000') {
  const m = Number(milestoneHours) || 0;
  if (cycle === 'ciclo_3000') {
    const rem = m % 12000;
    if (rem === 3000) return 'Plan A — 3000 horas';
    if (rem === 6000) return 'Plan B — 6000 horas';
    if (rem === 9000) return 'Plan A — 3000 horas';
    return 'Plan C — 12000 horas'; // rem === 0
  } else {
    // Standard ciclo_2000
    const rem = m % 8000;
    if (rem === 2000) return 'Plan A — 2000 horas';
    if (rem === 4000) return 'Plan B — 4000 horas';
    if (rem === 6000) return 'Plan A — 2000 horas';
    return 'Plan C — 8000 horas'; // rem === 0
  }
}

function computeNextMilestoneHours(lastMaintHours, cycle = 'ciclo_2000') {
  const step = cycle === 'ciclo_3000' ? 3000 : 2000;
  const lastH = Number(lastMaintHours) || 0;
  return (Math.floor(lastH / step) + 1) * step;
}

function determineNextMaintenancePlan(equipment, lastMaint = null) {
  const cycle = equipment.maintenanceCycle || equipment.cycleType || 'ciclo_2000';
  const isCycle3k = cycle === 'ciclo_3000';
  const lm = lastMaint || equipment.lastMaintenance || null;

  if (!lm || ((lm.hourMeter === undefined || lm.hourMeter === null || lm.hourMeter === '') && !lm.plan && !lm.date)) {
    return {
      nextPlan: null,
      nextServiceType: 'PENDIENTE DE CONFIGURACIÓN',
      nextMilestoneHours: null
    };
  }

  const lastHours = Number(lm.hourMeter !== undefined && lm.hourMeter !== null && lm.hourMeter !== '' ? lm.hourMeter : (lm.hours || 0));
  const lastPlanLabel = formatMaintenanceTypeLabel(lm.plan);

  // Historial cronológico de mantenimientos previos
  const history = Array.isArray(equipment.readingsHistory) ? [...equipment.readingsHistory] : [];
  const maintHistory = history
    .filter(h => (h.type === 'mantenimiento' || h.type === 'maintenance' || h.plan) && h.type !== 'reading')
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0) || (Number(a.hourMeter || 0) - Number(b.hourMeter || 0)));

  if (isCycle3k) {
    const step = 3000;
    const nextMilestoneHours = (Math.floor(lastHours / step) + 1) * step;

    // SECUENCIA B: 3,000 h → 6,000 h → 3,000 h → 12,000 h → repetir
    let nextServiceType = '3,000 h';
    let nextPlanName = 'Plan A — 3000 horas';

    if (lastPlanLabel === '6,000 h') {
      nextServiceType = '3,000 h';
      nextPlanName = 'Plan A — 3000 horas';
    } else if (lastPlanLabel === '12,000 h') {
      nextServiceType = '3,000 h';
      nextPlanName = 'Plan A — 3000 horas';
    } else if (lastPlanLabel === '3,000 h') {
      let prevMaint = null;
      if (maintHistory.length >= 2) {
        prevMaint = maintHistory[maintHistory.length - 2];
      }
      const prevLabel = prevMaint ? formatMaintenanceTypeLabel(prevMaint.plan) : null;

      if (prevLabel === '6,000 h') {
        nextServiceType = '12,000 h';
        nextPlanName = 'Plan C — 12000 horas';
      } else if (prevLabel === '12,000 h') {
        nextServiceType = '6,000 h';
        nextPlanName = 'Plan B — 6000 horas';
      } else {
        const rem = nextMilestoneHours % 12000;
        if (rem === 6000) {
          nextServiceType = '6,000 h';
          nextPlanName = 'Plan B — 6000 horas';
        } else if (rem === 0) {
          nextServiceType = '12,000 h';
          nextPlanName = 'Plan C — 12000 horas';
        } else {
          nextServiceType = '3,000 h';
          nextPlanName = 'Plan A — 3000 horas';
        }
      }
    } else {
      const rem = nextMilestoneHours % 12000;
      if (rem === 3000 || rem === 9000) {
        nextServiceType = '3,000 h';
        nextPlanName = 'Plan A — 3000 horas';
      } else if (rem === 6000) {
        nextServiceType = '6,000 h';
        nextPlanName = 'Plan B — 6000 horas';
      } else {
        nextServiceType = '12,000 h';
        nextPlanName = 'Plan C — 12000 horas';
      }
    }

    return {
      nextPlan: nextPlanName,
      nextServiceType,
      nextMilestoneHours
    };
  } else {
    const step = 2000;
    const nextMilestoneHours = (Math.floor(lastHours / step) + 1) * step;

    // SECUENCIA A: 2,000 h → 4,000 h → 2,000 h → 8,000 h → repetir
    let nextServiceType = '2,000 h';
    let nextPlanName = 'Plan A — 2000 horas';

    if (lastPlanLabel === '4,000 h') {
      nextServiceType = '2,000 h';
      nextPlanName = 'Plan A — 2000 horas';
    } else if (lastPlanLabel === '8,000 h') {
      nextServiceType = '2,000 h';
      nextPlanName = 'Plan A — 2000 horas';
    } else if (lastPlanLabel === '2,000 h') {
      let prevMaint = null;
      if (maintHistory.length >= 2) {
        prevMaint = maintHistory[maintHistory.length - 2];
      }
      const prevLabel = prevMaint ? formatMaintenanceTypeLabel(prevMaint.plan) : null;

      if (prevLabel === '4,000 h') {
        nextServiceType = '8,000 h';
        nextPlanName = 'Plan C — 8000 horas';
      } else if (prevLabel === '8,000 h') {
        nextServiceType = '4,000 h';
        nextPlanName = 'Plan B — 4000 horas';
      } else {
        const rem = nextMilestoneHours % 8000;
        if (rem === 4000) {
          nextServiceType = '4,000 h';
          nextPlanName = 'Plan B — 4000 horas';
        } else if (rem === 0) {
          nextServiceType = '8,000 h';
          nextPlanName = 'Plan C — 8000 horas';
        } else {
          nextServiceType = '2,000 h';
          nextPlanName = 'Plan A — 2000 horas';
        }
      }
    } else {
      const rem = nextMilestoneHours % 8000;
      if (rem === 2000 || rem === 6000) {
        nextServiceType = '2,000 h';
        nextPlanName = 'Plan A — 2000 horas';
      } else if (rem === 4000) {
        nextServiceType = '4,000 h';
        nextPlanName = 'Plan B — 4000 horas';
      } else {
        nextServiceType = '8,000 h';
        nextPlanName = 'Plan C — 8000 horas';
      }
    }

    return {
      nextPlan: nextPlanName,
      nextServiceType,
      nextMilestoneHours
    };
  }
}

function calculateEquipmentHorometerMetrics(equipment, currentDateStr = null) {
  const today = currentDateStr || new Date().toISOString().split('T')[0];
  const cycle = equipment.maintenanceCycle || equipment.cycleType || 'ciclo_2000';
  const step = cycle === 'ciclo_3000' ? 3000 : 2000;
  const currentHours = Number(equipment.hourMeter) || 0;

  const lastMaint = equipment.lastMaintenance || null;
  const nextMaintConfig = equipment.nextMaintenance || null;

  let lastMaintDate = lastMaint?.date || null;
  let lastMaintHours = (lastMaint?.hourMeter !== undefined && lastMaint?.hourMeter !== null && lastMaint?.hourMeter !== '')
    ? Number(lastMaint.hourMeter)
    : null;
  let lastMaintPlan = lastMaint?.plan || null;

  const seq = determineNextMaintenancePlan(equipment, lastMaint);
  let nextMilestone = nextMaintConfig?.milestoneHours ? Number(nextMaintConfig.milestoneHours) : seq.nextMilestoneHours;
  let nextPlan = nextMaintConfig?.plan || seq.nextPlan;
  let nextServiceType = seq.nextServiceType;
  let lastMaintenanceType = formatMaintenanceTypeLabel(lastMaintPlan) || (lastMaintDate ? lastMaintPlan : null);

  const hasHistoryOrConfig = (lastMaintHours !== null && lastMaintDate) || nextMilestone !== null;

  if (!hasHistoryOrConfig) {
    return {
      status: 'Pendiente de configuración',
      statusCode: 'pending_config',
      statusLabel: 'Pendiente de configuración',
      simplifiedStatus: 'PENDIENTE DE DATOS',
      lastMaintenanceType: null,
      nextServiceType: 'PENDIENTE DE CONFIGURACIÓN',
      statusColor: 'slate',
      statusIcon: '⚪',
      currentHours,
      lastMaintDate: null,
      lastMaintHours: null,
      lastMaintPlan: null,
      nextMilestone: null,
      nextPlan: null,
      hoursRemaining: null,
      quarterlyEstimatedDate: null,
      usageEstimatedDate: null,
      isHoursOverdue: false,
      isDateOverdue: false,
      isHoursNear: false,
      isDateNear: false,
      isConfigPending: true,
      cycle,
      alertThreshold: equipment.alertThresholdHours || 200,
      multipleMilestonesWarning: false,
      alertReason: 'Equipo sin línea base configurada.',
      urgencyRank: 8,
      urgencyScore: 10
    };
  }

  if (nextMilestone === null && lastMaintHours !== null) {
    nextMilestone = seq.nextMilestoneHours || computeNextMilestoneHours(lastMaintHours, cycle);
  }
  if (!nextPlan && nextMilestone !== null) {
    nextPlan = seq.nextPlan || getPlanForMilestone(nextMilestone, cycle);
  }

  const hoursRemaining = nextMilestone !== null ? (nextMilestone - currentHours) : null;
  const quarterlyEstimatedDate = lastMaintDate ? addCalendarMonths(lastMaintDate, 3) : null;

  let usageEstimatedDate = null;
  const monthlyAvg = Number(equipment.monthlyAverageHours) || 0;
  if (monthlyAvg > 0 && hoursRemaining !== null && hoursRemaining > 0) {
    const daysRemaining = Math.round((hoursRemaining / monthlyAvg) * 30.4375);
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() + daysRemaining);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dayStr = String(d.getDate()).padStart(2, '0');
    usageEstimatedDate = `${y}-${m}-${dayStr}`;
  }

  const alertThreshold = Number(equipment.alertThresholdHours) || 200;
  const isHoursOverdue = hoursRemaining !== null && hoursRemaining <= 0;
  const isHoursNear = hoursRemaining !== null && !isHoursOverdue && hoursRemaining <= alertThreshold;

  let isDateOverdue = false;
  let isDateNear = false;
  let daysUntilTrim = null;

  if (quarterlyEstimatedDate) {
    const todayMs = new Date(today + 'T00:00:00').getTime();
    const trimMs = new Date(quarterlyEstimatedDate + 'T00:00:00').getTime();
    const diffDays = Math.round((trimMs - todayMs) / (1000 * 60 * 60 * 24));
    daysUntilTrim = diffDays;
    if (diffDays <= 0) {
      isDateOverdue = true;
    } else if (diffDays <= 15) {
      isDateNear = true;
    }
  }

  const multipleMilestonesWarning = (hoursRemaining !== null && hoursRemaining <= -step);

  let statusCode = 'up_to_date';
  let statusLabel = 'Al día';
  let statusColor = 'green';
  let statusIcon = '🟢';
  let simplifiedStatus = 'AL DÍA';
  let alertReason = '';
  let urgencyRank = 7;
  let urgencyScore = 0;

  if (isHoursOverdue && isDateOverdue) {
    statusCode = 'overdue_both';
    statusLabel = 'Vencido por ambos criterios';
    simplifiedStatus = 'VENCIDO';
    statusColor = 'crimson';
    statusIcon = '⛔';
    urgencyRank = 1;
    const hDiff = Math.abs(hoursRemaining || 0);
    const dDiff = Math.abs(daysUntilTrim || 0);
    alertReason = `Vencido crítico: superó el hito de ${nextMilestone ? nextMilestone.toLocaleString() + ' h' : ''} por ${hDiff.toLocaleString()} h y excedió el límite trimestral (${quarterlyEstimatedDate}) por ${dDiff} día(s).`;
    urgencyScore = 1000 + hDiff + (dDiff * 10);
  } else if (isHoursOverdue) {
    statusCode = 'overdue_hours';
    statusLabel = 'Vencido por horas';
    simplifiedStatus = 'VENCIDO';
    statusColor = 'red';
    statusIcon = '🔴';
    urgencyRank = 2;
    const hDiff = Math.abs(hoursRemaining || 0);
    alertReason = `Vencido por horas: superó el hito de ${nextMilestone ? nextMilestone.toLocaleString() + ' h' : ''} por ${hDiff.toLocaleString()} h de operación acumulada.`;
    urgencyScore = 800 + hDiff;
  } else if (isDateOverdue) {
    statusCode = 'overdue_date';
    statusLabel = 'Vencido por fecha';
    simplifiedStatus = 'VENCIDO';
    statusColor = 'orange';
    statusIcon = '🟠';
    urgencyRank = 3;
    const dDiff = Math.abs(daysUntilTrim || 0);
    alertReason = `Vencido por fecha: superó el plazo trimestral de 3 meses (${quarterlyEstimatedDate}) por ${dDiff} día(s).`;
    urgencyScore = 600 + (dDiff * 10);
  } else if (isHoursNear && isDateNear) {
    statusCode = 'upcoming_both';
    statusLabel = 'Próximo por horas y fecha';
    simplifiedStatus = 'PRÓXIMO';
    statusColor = 'amber';
    statusIcon = '🟡';
    urgencyRank = 4;
    alertReason = `Atención preventiva prioritaria: restan solo ${hoursRemaining} h para el hito y quedan ${daysUntilTrim} día(s) para la fecha trimestral.`;
    urgencyScore = 400 + (alertThreshold - Math.min(hoursRemaining || 0, alertThreshold));
  } else if (isHoursNear) {
    statusCode = 'upcoming_hours';
    statusLabel = 'Próximo por horas';
    simplifiedStatus = 'PRÓXIMO';
    statusColor = 'amber';
    statusIcon = '🟡';
    urgencyRank = 5;
    alertReason = `Próximo por horas: restan ${hoursRemaining} h para alcanzar el hito de ${nextMilestone ? nextMilestone.toLocaleString() + ' h' : ''}.`;
    urgencyScore = 300 + (alertThreshold - Math.min(hoursRemaining || 0, alertThreshold));
  } else if (isDateNear) {
    statusCode = 'upcoming_date';
    statusLabel = 'Próximo por fecha';
    simplifiedStatus = 'PRÓXIMO';
    statusColor = 'amber';
    statusIcon = '🟡';
    urgencyRank = 6;
    alertReason = `Próximo por fecha: restan ${daysUntilTrim} día(s) para la fecha trimestral recomendada (${quarterlyEstimatedDate}).`;
    urgencyScore = 200 + (15 - Math.min(daysUntilTrim || 0, 15));
  } else {
    // up_to_date
    statusCode = 'up_to_date';
    statusLabel = 'Al día';
    simplifiedStatus = 'AL DÍA';
    urgencyRank = 7;
    alertReason = `Operación al día. Límite trimestral: ${quarterlyEstimatedDate || 'Sin fecha'}.`;
    urgencyScore = 50;
  }

  if (!lastMaintDate) {
    simplifiedStatus = 'PENDIENTE DE DATOS';
  }

  return {
    status: statusLabel,
    statusCode,
    statusLabel,
    simplifiedStatus,
    lastMaintenanceType,
    nextServiceType,
    statusColor,
    statusIcon,
    alertReason,
    urgencyRank,
    urgencyScore,
    currentHours,
    lastMaintDate,
    lastMaintHours,
    lastMaintPlan,
    nextMilestone,
    nextPlan,
    hoursRemaining,
    quarterlyEstimatedDate,
    usageEstimatedDate,
    isHoursOverdue,
    isDateOverdue,
    isHoursNear,
    isDateNear,
    daysUntilTrim,
    isConfigPending: false,
    cycle,
    alertThreshold,
    multipleMilestonesWarning
  };
}

function normalizeStr(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function matchReportToEquipment(report, equipments) {
  if (!report || !Array.isArray(equipments)) return -1;
  const repSerialNorm = normalizeStr(report.serialNumber);
  const repApiNorm = normalizeStr(report.apiCode);
  const repClientNorm = normalizeStr(report.client);
  const repModelNorm = normalizeStr(report.model);

  return equipments.findIndex(e => {
    // 1. Direct equipment ID match
    if (report.equipmentId && e.id === report.equipmentId) return true;

    // 2. Normalized API Code match
    const eApiNorm = normalizeStr(e.apiCode);
    if (repApiNorm && eApiNorm && repApiNorm === eApiNorm) return true;

    // 3. Normalized Serial Number match
    const eSerialNorm = normalizeStr(e.serialNumber);
    if (repSerialNorm && eSerialNorm) {
      if (repSerialNorm === eSerialNorm) return true;
      if (repSerialNorm.length >= 4 && eSerialNorm.length >= 4) {
        if (repSerialNorm.includes(eSerialNorm) || eSerialNorm.includes(repSerialNorm)) return true;
      }
    }

    // 4. Model + Client matching (handles small differences like 'EMUSAS S.A.C.' vs 'EMUSA S.A.C')
    const eClientNorm = normalizeStr(e.client);
    const eModelNorm = normalizeStr(e.model);
    if (repModelNorm && eModelNorm && (repModelNorm === eModelNorm || repModelNorm.includes(eModelNorm) || eModelNorm.includes(repModelNorm))) {
      if (repClientNorm && eClientNorm && (repClientNorm.includes(eClientNorm) || eClientNorm.includes(repClientNorm))) {
        return true;
      }
    }

    return false;
  });
}

function applyReportToEquipmentHorometer(report) {
  if (!report || report.status !== 'Finalizado') {
    return { success: false, reason: 'El reporte no tiene estado Finalizado.' };
  }

  const equipments = readJson(EQUIPMENTS_FILE, []);
  const eqIdx = matchReportToEquipment(report, equipments);

  if (eqIdx === -1) {
    console.warn(`[Horometers] No se encontró equipo asociado para el reporte ${report.reportNumber} (${report.client} - ${report.model}).`);
    return { success: false, reason: 'No se encontró equipo en catálogo que coincida con el reporte.' };
  }

  const eq = equipments[eqIdx];
  const repHourMeter = Number(report.hourMeter);
  const validHour = !isNaN(repHourMeter) && repHourMeter >= 0;
  const currentEqHours = Number(eq.hourMeter) || Number(eq.hours) || 0;
  const repDate = report.date || new Date().toISOString().split('T')[0];
  const repNumber = report.reportNumber || '';

  if (!Array.isArray(eq.readingsHistory)) {
    eq.readingsHistory = [];
  }

  const latestExistingDate = eq.lastReadingDate || (eq.lastMaintenance && eq.lastMaintenance.date) || '';
  const isOlderDate = latestExistingDate && repDate < latestExistingDate;

  const existingIdx = repNumber ? eq.readingsHistory.findIndex(h => h.reportNumber === repNumber) : -1;

  const histEntry = {
    id: existingIdx !== -1 ? eq.readingsHistory[existingIdx].id : `maint-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    date: repDate,
    hourMeter: validHour ? repHourMeter : currentEqHours,
    hours: validHour ? repHourMeter : currentEqHours,
    type: 'mantenimiento',
    plan: report.maintenanceType || 'Plan A — 2000 horas',
    reportNumber: repNumber,
    notes: `Servicio técnico finalizado: ${report.maintenanceType || ''}`,
    user: report.technician || 'Técnico INDUSTRAC',
    technician: report.technician || 'Técnico INDUSTRAC'
  };

  if (existingIdx !== -1) {
    eq.readingsHistory[existingIdx] = histEntry;
  } else {
    eq.readingsHistory.unshift(histEntry);
  }

  // Regla de negocio: Actualizar horómetro actual si la lectura es válida y no es una fecha más antigua
  let horometerUpdated = false;
  if (validHour && !isOlderDate) {
    eq.hourMeter = String(repHourMeter);
    eq.hours = repHourMeter;
    eq.lastReadingDate = repDate;
    horometerUpdated = true;
  }

  // Buscar el mantenimiento cronológicamente más reciente para no sobrescribir con fechas antiguas
  const allMaints = eq.readingsHistory
    .filter(h => (h.type === 'mantenimiento' || h.type === 'maintenance' || h.plan) && h.type !== 'reading')
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0) || (Number(b.hourMeter || 0) - Number(a.hourMeter || 0)));

  const latestMaint = allMaints[0] || histEntry;

  eq.lastMaintenance = {
    date: latestMaint.date,
    hourMeter: Number(latestMaint.hourMeter || latestMaint.hours || 0),
    plan: latestMaint.plan || report.maintenanceType || 'Plan A — 2000 horas',
    reportNumber: latestMaint.reportNumber || repNumber,
    notes: latestMaint.notes || `Reporte técnico ${repNumber} finalizado.`
  };

  // Sincronizar fecha de última lectura/servicio con la entrada más reciente del historial
  const allReadings = eq.readingsHistory.slice().sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  if (allReadings.length > 0 && allReadings[0].date) {
    if (!eq.lastReadingDate || new Date(allReadings[0].date) >= new Date(eq.lastReadingDate)) {
      eq.lastReadingDate = allReadings[0].date;
    }
  }

  // Recalcular secuencia y próximo hito a partir del historial acumulado
  const seq = determineNextMaintenancePlan(eq, eq.lastMaintenance);
  eq.nextMaintenance = {
    milestoneHours: seq.nextMilestoneHours,
    plan: seq.nextPlan
  };
  eq.updatedAt = new Date().toISOString();

  writeJson(EQUIPMENTS_FILE, equipments);

  return {
    success: true,
    equipmentId: eq.id,
    equipmentName: `${eq.client} — ${eq.model} [${eq.apiCode || eq.serialNumber}]`,
    horometerUpdated,
    newHorometer: eq.hourMeter,
    previousHorometer: currentEqHours,
    lastMaintenance: eq.lastMaintenance,
    nextMaintenance: eq.nextMaintenance
  };
}

// Desvincula un reporte eliminado de la bitácora del equipo y recalcula su horómetro
function removeReportFromEquipmentHorometer(report) {
  if (!report) return;
  const equipments = readJson(EQUIPMENTS_FILE, []);
  const repNum = report.reportNumber || '';
  const repId = report.id || '';
  let modified = false;

  equipments.forEach(eq => {
    if (!Array.isArray(eq.readingsHistory)) return;

    const hadReport = eq.readingsHistory.some(r => 
      (repNum && r.reportNumber === repNum) || 
      (repId && (r.id === repId || r.reportId === repId || r.id === `hist-boot-${repId}`))
    );

    if (hadReport) {
      eq.readingsHistory = eq.readingsHistory.filter(r => 
        !(repNum && r.reportNumber === repNum) &&
        !(repId && (r.id === repId || r.reportId === repId || r.id === `hist-boot-${repId}`))
      );
      modified = true;

      // Recalcular mantenimientos restantes
      const allMaints = eq.readingsHistory
        .filter(h => (h.type === 'mantenimiento' || h.type === 'maintenance' || h.plan) && h.type !== 'reading')
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0) || (Number(b.hourMeter || 0) - Number(a.hourMeter || 0)));

      if (allMaints.length > 0) {
        const latestM = allMaints[0];
        eq.lastMaintenance = {
          date: latestM.date,
          hourMeter: Number(latestM.hourMeter || latestM.hours || 0),
          plan: latestM.plan || 'Plan A — 2000 horas',
          reportNumber: latestM.reportNumber || '',
          notes: latestM.notes || 'Actualizado tras eliminar reporte.'
        };
        const allReadings = eq.readingsHistory.slice().sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        eq.lastReadingDate = allReadings[0]?.date || latestM.date;
        eq.hourMeter = String(latestM.hourMeter || latestM.hours || 0);
        eq.hours = Number(eq.hourMeter);
        const seq = determineNextMaintenancePlan(eq, eq.lastMaintenance);
        eq.nextMaintenance = {
          milestoneHours: seq.nextMilestoneHours,
          plan: seq.nextPlan
        };
      } else {
        eq.lastMaintenance = null;
        eq.nextMaintenance = null;
        eq.lastReadingDate = null;
        eq.hourMeter = '0';
        eq.hours = 0;
      }
      eq.updatedAt = new Date().toISOString();
    }
  });

  if (modified) {
    writeJson(EQUIPMENTS_FILE, equipments);
  }
}

// Automatically bootstrap equipment maintenance from existing reports if unlinked or outdated
function bootstrapHorometersFromReports() {
  const equipments = readJson(EQUIPMENTS_FILE, []);
  const reports = readJson(REPORTS_FILE, []);
  let modified = false;

  const finalizedReports = reports
    .filter(r => r.status === 'Finalizado')
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

  finalizedReports.forEach(rep => {
    const eqIdx = matchReportToEquipment(rep, equipments);
    if (eqIdx !== -1) {
      const eq = equipments[eqIdx];
      const repHour = Number(rep.hourMeter);
      const validH = !isNaN(repHour) && repHour >= 0;
      const repDate = rep.date || new Date().toISOString().split('T')[0];
      const repNum = rep.reportNumber || '';

      if (!Array.isArray(eq.readingsHistory)) eq.readingsHistory = [];

      const existsIdx = repNum ? eq.readingsHistory.findIndex(h => h.reportNumber === repNum) : -1;
      const entry = {
        id: existsIdx !== -1 ? eq.readingsHistory[existsIdx].id : `hist-boot-${rep.id || Date.now()}`,
        date: repDate,
        hourMeter: validH ? repHour : (Number(eq.hourMeter) || 0),
        hours: validH ? repHour : (Number(eq.hourMeter) || 0),
        type: 'mantenimiento',
        plan: rep.maintenanceType || 'Plan A — 2000 horas',
        reportNumber: repNum,
        notes: `Historial verificado: ${rep.maintenanceType || ''}`,
        user: rep.technician || 'Técnico INDUSTRAC'
      };

      if (existsIdx !== -1) {
        eq.readingsHistory[existsIdx] = entry;
      } else {
        eq.readingsHistory.push(entry);
      }

      if (validH && (!eq.lastReadingDate || repDate >= eq.lastReadingDate || repHour >= (Number(eq.hourMeter) || 0))) {
        eq.hourMeter = String(repHour);
        eq.hours = repHour;
        eq.lastReadingDate = repDate;
      }

      const allMaints = eq.readingsHistory
        .filter(h => (h.type === 'mantenimiento' || h.type === 'maintenance' || h.plan) && h.type !== 'reading')
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0) || (Number(b.hourMeter || 0) - Number(a.hourMeter || 0)));

      const latestM = allMaints[0] || entry;
      eq.lastMaintenance = {
        date: latestM.date,
        hourMeter: Number(latestM.hourMeter || latestM.hours || 0),
        plan: latestM.plan || rep.maintenanceType || 'Plan A — 2000 horas',
        reportNumber: latestM.reportNumber || repNum,
        notes: latestM.notes || 'Vinculado automáticamente desde historial de reportes.'
      };

      const seq = determineNextMaintenancePlan(eq, eq.lastMaintenance);
      eq.nextMaintenance = {
        milestoneHours: seq.nextMilestoneHours,
        plan: seq.nextPlan
      };
      modified = true;
    }
  });

  if (modified) {
    writeJson(EQUIPMENTS_FILE, equipments);
  }
}

// Run bootstrap once
bootstrapHorometersFromReports();

// --- MONTHLY MAINTENANCE PROJECTION ENGINE ---
function computeMonthlyMaintenanceProjection(enrichedList, todayStr = null) {
  const today = todayStr ? new Date(todayStr + 'T00:00:00') : new Date();
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
  const fullMonthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const buckets = [];

  // Bucket 0: Vencidos / Inmediatos
  buckets.push({
    monthKey: 'vencidos',
    label: 'Vencidos',
    fullLabel: 'Vencidos / Atención Inmediata',
    subLabel: 'Superaron hito u horizonte trimestral',
    year: today.getFullYear(),
    monthNumber: today.getMonth() + 1,
    isOverdueBucket: true,
    isCurrentMonth: false,
    total: 0,
    planA: 0,
    planB: 0,
    planC: 0,
    cycle2k: 0,
    cycle3k: 0,
    equipmentIds: [],
    equipments: []
  });

  const curYear = today.getFullYear();
  const curMonth = today.getMonth(); // 0-indexed
  const monthKeys = [];

  for (let i = 0; i < 6; i++) {
    const targetDate = new Date(curYear, curMonth + i, 1);
    const y = targetDate.getFullYear();
    const m = targetDate.getMonth();
    const key = `${y}-${String(m + 1).padStart(2, '0')}`;
    monthKeys.push(key);
    buckets.push({
      monthKey: key,
      label: `${monthNames[m]} ${y}`,
      fullLabel: `${fullMonthNames[m]} ${y}`,
      subLabel: i === 0 ? 'Mes en curso' : `Proyección ${fullMonthNames[m]}`,
      year: y,
      monthNumber: m + 1,
      isOverdueBucket: false,
      isCurrentMonth: i === 0,
      total: 0,
      planA: 0,
      planB: 0,
      planC: 0,
      cycle2k: 0,
      cycle3k: 0,
      equipmentIds: [],
      equipments: []
    });
  }

  // Bucket 7: Mantenimientos posteriores (+6m)
  const nextTargetDate = new Date(curYear, curMonth + 6, 1);
  const postYear = nextTargetDate.getFullYear();
  const postMonth = nextTargetDate.getMonth();
  buckets.push({
    monthKey: 'posterior',
    label: `${monthNames[postMonth]} ${postYear}+`,
    fullLabel: `Posterior (${monthNames[postMonth]} ${postYear} en adelante)`,
    subLabel: 'Mantenimientos en horizontes lejanos',
    year: postYear,
    monthNumber: postMonth + 1,
    isOverdueBucket: false,
    isCurrentMonth: false,
    total: 0,
    planA: 0,
    planB: 0,
    planC: 0,
    cycle2k: 0,
    cycle3k: 0,
    equipmentIds: [],
    equipments: []
  });

  // Bucket 8: Sin previsión (pending_config or no date)
  const pendingBucket = {
    monthKey: 'sin_prevision',
    label: 'Sin previsión',
    fullLabel: 'Equipos sin previsión fiable',
    subLabel: 'Requieren configurar línea base o ciclo',
    year: null,
    monthNumber: null,
    isOverdueBucket: false,
    isCurrentMonth: false,
    total: 0,
    planA: 0,
    planB: 0,
    planC: 0,
    cycle2k: 0,
    cycle3k: 0,
    equipmentIds: [],
    equipments: []
  };

  // Group each equipment into EXACTLY ONE bucket (no duplicate counting)
  enrichedList.forEach(eq => {
    const briefItem = {
      id: eq.id,
      client: eq.client,
      model: eq.model,
      apiCode: eq.apiCode,
      serialNumber: eq.serialNumber,
      nextPlan: eq.nextPlan,
      nextMilestoneHours: eq.nextMilestoneHours,
      currentHours: eq.currentHours,
      hoursRemaining: eq.hoursRemaining,
      quarterlyEstimatedDate: eq.quarterlyEstimatedDate,
      usageEstimatedDate: eq.usageEstimatedDate,
      status: eq.status,
      statusLabel: eq.statusLabel,
      statusClass: eq.statusClass,
      cycleType: eq.cycleType,
      isDemo: !!eq.isDemo
    };

    const addEqToBucket = (b) => {
      b.total++;
      b.equipmentIds.push(eq.id);
      b.equipments.push(briefItem);

      const planName = (eq.nextPlan || '').toLowerCase();
      if (planName.includes('plan a')) b.planA++;
      else if (planName.includes('plan b')) b.planB++;
      else if (planName.includes('plan c')) b.planC++;
      else b.planA++;

      if (eq.cycleType === 'ciclo_3000') b.cycle3k++;
      else b.cycle2k++;
    };

    if (eq.status === 'pending_config') {
      addEqToBucket(pendingBucket);
      return;
    }

    // 1. If overdue by either or both criteria -> Vencidos
    if (eq.isOverdueHours || eq.isOverdueDate) {
      addEqToBucket(buckets[0]);
      return;
    }

    // 2. Projected date: earliest between usageEstimatedDate and quarterlyEstimatedDate
    let projectedDateStr = null;
    if (eq.usageEstimatedDate && eq.quarterlyEstimatedDate) {
      projectedDateStr = eq.usageEstimatedDate < eq.quarterlyEstimatedDate ? eq.usageEstimatedDate : eq.quarterlyEstimatedDate;
    } else {
      projectedDateStr = eq.quarterlyEstimatedDate || eq.usageEstimatedDate || null;
    }

    if (!projectedDateStr) {
      addEqToBucket(pendingBucket);
      return;
    }

    const projMonthKey = projectedDateStr.substring(0, 7); // YYYY-MM
    const matchedBucket = buckets.find(b => b.monthKey === projMonthKey);

    if (matchedBucket) {
      addEqToBucket(matchedBucket);
    } else if (projMonthKey < monthKeys[0]) {
      addEqToBucket(buckets[0]);
    } else {
      const postB = buckets.find(b => b.monthKey === 'posterior');
      if (postB) addEqToBucket(postB);
      else addEqToBucket(pendingBucket);
    }
  });

  buckets.push(pendingBucket);

  return {
    disclaimer: 'Las fechas proyectadas corresponden a estimaciones preventivas basadas en el límite trimestral (3 meses) y/o tasa de uso por horómetro. No representan citas comerciales confirmadas.',
    generatedAt: new Date().toISOString(),
    buckets
  };
}

// --- HOROMETERS API ROUTES ---

// 1. Get Horometers Dashboard & Equipment Metrics
app.get('/api/horometers', (req, res) => {
  const allEquipments = readJson(EQUIPMENTS_FILE, []);
  const today = req.query.date || new Date().toISOString().split('T')[0];
  const mode = 'real';

  // Strictly real operational equipments for INDUSTRAC production
  const filteredEquipments = allEquipments.filter(e => !e.isDemo);
  const realEquipmentsCount = filteredEquipments.length;
  const demoEquipmentsCount = 0;

  let totalEquipments = filteredEquipments.length;
  let upToDate = 0;
  let upcoming = 0;
  let overdueHours = 0;
  let overdueDate = 0;
  let overdueBoth = 0;
  let pendingConfig = 0;

  const enriched = filteredEquipments.map(eq => {
    const metrics = calculateEquipmentHorometerMetrics(eq, today);
    if (metrics.statusCode === 'pending_config') pendingConfig++;
    else if (metrics.statusCode === 'overdue_both') overdueBoth++;
    else if (metrics.statusCode === 'overdue_hours') overdueHours++;
    else if (metrics.statusCode === 'overdue_date') overdueDate++;
    else if (metrics.statusCode.startsWith('upcoming')) upcoming++;
    else upToDate++;

    const statusClass = 'status-' + (metrics.statusCode || 'pending_config').replace(/_/g, '-');

    return {
      ...eq,
      metrics,
      status: metrics.statusCode,
      statusLabel: metrics.statusLabel,
      simplifiedStatus: metrics.simplifiedStatus,
      lastServiceDate: metrics.lastMaintDate,
      lastHorometer: metrics.lastMaintHours,
      lastMaintenanceType: metrics.lastMaintenanceType,
      nextServiceType: metrics.nextServiceType,
      estimatedDate: metrics.quarterlyEstimatedDate,
      statusClass,
      statusColor: metrics.statusColor,
      statusIcon: metrics.statusIcon,
      alertReason: metrics.alertReason,
      urgencyRank: metrics.urgencyRank,
      urgencyScore: metrics.urgencyScore,
      operationalStatus: eq.status,
      currentHours: metrics.currentHours,
      lastMaintDate: metrics.lastMaintDate,
      lastMaintHours: metrics.lastMaintHours,
      lastPlan: metrics.lastMaintPlan,
      nextMilestoneHours: metrics.nextMilestone,
      nextPlan: metrics.nextPlan,
      hoursRemaining: metrics.hoursRemaining,
      quarterlyEstimatedDate: metrics.quarterlyEstimatedDate,
      usageEstimatedDate: metrics.usageEstimatedDate,
      daysToQuarterly: metrics.daysUntilTrim,
      isOverdueHours: metrics.isHoursOverdue,
      isOverdueDate: metrics.isDateOverdue,
      isUpcomingHours: metrics.isHoursNear,
      isUpcomingDate: metrics.isDateNear,
      cycleType: metrics.cycle,
      alertThresholdHours: metrics.alertThreshold,
      monthlyAverageHours: Number(eq.monthlyAverageHours) || null,
      isDemo: !!eq.isDemo
    };
  });

  // Compute Priority Attention list (Machines needing attention first, ordered by urgency)
  const priorityAttention = enriched
    .filter(eq => eq.status !== 'pending_config' && eq.status !== 'up_to_date')
    .sort((a, b) => (a.urgencyRank - b.urgencyRank) || (b.urgencyScore - a.urgencyScore) || (a.hoursRemaining - b.hoursRemaining));

  // If there are few priority items and some up_to_date machines exist, add top nearest
  if (priorityAttention.length < 4) {
    const upcomingNormal = enriched
      .filter(eq => eq.status === 'up_to_date' && eq.hoursRemaining !== null)
      .sort((a, b) => a.hoursRemaining - b.hoursRemaining)
      .slice(0, 4 - priorityAttention.length);
    priorityAttention.push(...upcomingNormal);
  }

  // Compute Monthly Maintenance Projection
  const monthlyProjection = computeMonthlyMaintenanceProjection(enriched, today);

  res.json({
    mode,
    realEquipmentsCount,
    demoEquipmentsCount,
    summary: {
      total: totalEquipments,
      totalEquipments,
      upToDate,
      upcomingTotal: upcoming,
      upcoming,
      overdueHours,
      overdueDate,
      overdueBoth,
      pendingConfig
    },
    priorityAttention,
    monthlyProjection,
    equipments: enriched
  });
});

// 2. Register New Horometer Reading
app.post('/api/equipments/:id/readings', (req, res) => {
  const equipments = readJson(EQUIPMENTS_FILE, []);
  const idx = equipments.findIndex(e => e.id === req.params.id);

  if (idx === -1) {
    return res.status(404).json({ error: 'Equipo no encontrado.' });
  }

  const eq = equipments[idx];
  const newHours = Number(req.body.hourMeter !== undefined ? req.body.hourMeter : req.body.hours);
  const currentHours = Number(eq.hourMeter !== undefined ? eq.hourMeter : (eq.hours || 0));
  const readingDate = req.body.date || new Date().toISOString().split('T')[0];
  const notes = (req.body.notes || '').trim();
  const user = (req.body.user || req.body.registeredBy || 'Administrador').trim();
  const confirmLower = !!(req.body.confirmLower || req.body.confirmed);

  if (isNaN(newHours) || newHours < 0) {
    return res.status(400).json({ error: 'La lectura del horómetro debe ser un número positivo mayor o igual a 0.' });
  }

  let warning = null;
  // Warn if new reading is lower than previous reading
  if (newHours < currentHours) {
    warning = `La lectura ingresada (${newHours} h) es menor que la lectura actual registrada (${currentHours} h).`;
  }

  if (!Array.isArray(eq.readingsHistory)) {
    eq.readingsHistory = [];
  }

  // Update current hours in both field conventions
  eq.hourMeter = String(newHours);
  eq.hours = newHours;
  eq.lastReadingDate = readingDate;
  eq.updatedAt = new Date().toISOString();

  // Prepend reading to history
  eq.readingsHistory.unshift({
    id: `read-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    date: readingDate,
    hourMeter: newHours,
    hours: newHours,
    type: 'reading',
    plan: null,
    reportNumber: null,
    notes: notes || 'Lectura periódica de horómetro.',
    registeredBy: user,
    user: user
  });

  writeJson(EQUIPMENTS_FILE, equipments);

  const metrics = calculateEquipmentHorometerMetrics(eq);
  res.json({
    message: 'Lectura de horómetro registrada exitosamente.',
    warning,
    equipment: eq,
    metrics
  });
});

// 3. Register Completed Maintenance Service
app.post('/api/equipments/:id/maintenance', (req, res) => {
  const equipments = readJson(EQUIPMENTS_FILE, []);
  const idx = equipments.findIndex(e => e.id === req.params.id);

  if (idx === -1) {
    return res.status(404).json({ error: 'Equipo no encontrado.' });
  }

  const eq = equipments[idx];
  const maintDate = req.body.date || new Date().toISOString().split('T')[0];
  const rawHours = req.body.hourMeter !== undefined ? req.body.hourMeter : req.body.hours;
  const maintHours = Number(rawHours !== undefined && rawHours !== '' ? rawHours : (eq.hourMeter || eq.hours || 0));
  const plan = req.body.plan || 'Plan A — 2000 horas';
  const reportNumber = (req.body.reportNumber || '').trim();
  const notes = (req.body.notes || '').trim();
  const user = (req.body.user || req.body.technician || 'Técnico INDUSTRAC').trim();
  const cycle = eq.maintenanceCycle || eq.cycleType || 'ciclo_2000';

  if (isNaN(maintHours) || maintHours < 0) {
    return res.status(400).json({ error: 'La lectura del horómetro en mantenimiento debe ser un número válido.' });
  }

  if (maintHours >= (Number(eq.hourMeter || eq.hours) || 0)) {
    eq.hourMeter = String(maintHours);
    eq.hours = maintHours;
    eq.lastReadingDate = maintDate;
  }

  if (!Array.isArray(eq.readingsHistory)) {
    eq.readingsHistory = [];
  }

  eq.readingsHistory.unshift({
    id: `maint-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    date: maintDate,
    hourMeter: maintHours,
    hours: maintHours,
    type: 'maintenance',
    plan: plan,
    reportNumber: reportNumber,
    notes: notes || `Mantenimiento ${plan} ejecutado.`,
    technician: user,
    user: user
  });

  eq.lastMaintenance = {
    date: maintDate,
    hourMeter: maintHours,
    plan: plan,
    reportNumber: reportNumber,
    notes: notes
  };

  const seq = determineNextMaintenancePlan(eq, eq.lastMaintenance);
  eq.nextMaintenance = {
    milestoneHours: seq.nextMilestoneHours,
    plan: seq.nextPlan
  };
  eq.updatedAt = new Date().toISOString();

  writeJson(EQUIPMENTS_FILE, equipments);

  const metrics = calculateEquipmentHorometerMetrics(eq);
  res.json({
    message: 'Mantenimiento registrado y ciclo avanzado con éxito.',
    equipment: eq,
    metrics
  });
});

// 4. Update Equipment Maintenance Baseline / Configuration
app.put('/api/equipments/:id/maintenance-config', (req, res) => {
  const equipments = readJson(EQUIPMENTS_FILE, []);
  const idx = equipments.findIndex(e => e.id === req.params.id);

  if (idx === -1) {
    return res.status(404).json({ error: 'Equipo no encontrado.' });
  }

  const eq = equipments[idx];
  const maintenanceCycle = req.body.maintenanceCycle || req.body.cycleType;
  const lastMaintenanceDate = req.body.lastMaintenanceDate || req.body.lastMaintDate;
  const lastMaintenanceHours = req.body.lastMaintenanceHours !== undefined ? req.body.lastMaintenanceHours : req.body.lastMaintHours;
  const lastMaintenancePlan = req.body.lastMaintenancePlan || req.body.lastPlan;
  const nextMilestoneHours = req.body.nextMilestoneHours;
  const nextPlan = req.body.nextPlan;
  const monthlyAverageHours = req.body.monthlyAverageHours;
  const alertThresholdHours = req.body.alertThresholdHours;

  if (maintenanceCycle) {
    eq.maintenanceCycle = maintenanceCycle;
    eq.cycleType = maintenanceCycle;
  }

  if (lastMaintenanceDate || lastMaintenanceHours !== undefined || lastMaintenancePlan) {
    eq.lastMaintenance = {
      date: lastMaintenanceDate || eq.lastMaintenance?.date || null,
      hourMeter: lastMaintenanceHours !== undefined && lastMaintenanceHours !== null && lastMaintenanceHours !== '' ? Number(lastMaintenanceHours) : eq.lastMaintenance?.hourMeter,
      plan: lastMaintenancePlan || eq.lastMaintenance?.plan || 'Plan A — 2000 horas',
      reportNumber: eq.lastMaintenance?.reportNumber || '',
      notes: eq.lastMaintenance?.notes || 'Configuración inicial de línea base'
    };
  }

  const cycle = eq.maintenanceCycle || 'ciclo_2000';
  let calcNextMilestone = nextMilestoneHours !== undefined && nextMilestoneHours !== null && nextMilestoneHours !== ''
    ? Number(nextMilestoneHours)
    : (eq.lastMaintenance?.hourMeter !== undefined ? computeNextMilestoneHours(eq.lastMaintenance.hourMeter, cycle) : null);

  let calcNextPlan = nextPlan || (calcNextMilestone !== null ? getPlanForMilestone(calcNextMilestone, cycle) : null);

  eq.nextMaintenance = {
    milestoneHours: calcNextMilestone,
    plan: calcNextPlan
  };

  if (monthlyAverageHours !== undefined) {
    eq.monthlyAverageHours = monthlyAverageHours !== null && monthlyAverageHours !== '' ? Number(monthlyAverageHours) : null;
  }

  if (alertThresholdHours !== undefined) {
    eq.alertThresholdHours = alertThresholdHours !== null && alertThresholdHours !== '' ? Number(alertThresholdHours) : 200;
  }

  if (req.body.currentHours !== undefined || req.body.hourMeter !== undefined) {
    const rawH = req.body.currentHours !== undefined ? req.body.currentHours : req.body.hourMeter;
    if (rawH !== null && rawH !== '') {
      eq.hourMeter = String(rawH);
      eq.hours = Number(rawH);
    }
  }

  eq.updatedAt = new Date().toISOString();
  writeJson(EQUIPMENTS_FILE, equipments);

  const metrics = calculateEquipmentHorometerMetrics(eq);
  res.json({
    message: 'Configuración de mantenimiento actualizada con éxito.',
    equipment: eq,
    metrics
  });
});

// 5. Get Equipment Horometer & Maintenance History
app.get('/api/equipments/:id/horometer-history', (req, res) => {
  const equipments = readJson(EQUIPMENTS_FILE, []);
  const eq = equipments.find(e => e.id === req.params.id || e.apiCode === req.params.id);

  if (!eq) {
    return res.status(404).json({ error: 'Equipo no encontrado.' });
  }

  const history = Array.isArray(eq.readingsHistory) ? eq.readingsHistory : [];
  res.json(history);
});

// --- DEMO DATA MANAGEMENT ENDPOINTS ---
app.get('/api/demo/status', (req, res) => {
  const clients = readJson(CLIENTS_FILE, []);
  const equipments = readJson(EQUIPMENTS_FILE, []);

  const demoClients = clients.filter(c => !!c.isDemo);
  const demoEquipments = equipments.filter(e => !!e.isDemo);

  res.json({
    isLoaded: demoClients.length > 0 || demoEquipments.length > 0,
    demoClientsCount: demoClients.length,
    demoEquipmentsCount: demoEquipments.length,
    totalClientsCount: clients.length,
    totalEquipmentsCount: equipments.length
  });
});

app.post('/api/demo/load', (req, res) => {
  initCatalogData();
  const clients = readJson(CLIENTS_FILE, []);
  const equipments = readJson(EQUIPMENTS_FILE, []);
  const demoClients = clients.filter(c => !!c.isDemo);
  const demoEquipments = equipments.filter(e => !!e.isDemo);

  res.json({
    message: 'Datos de demostración cargados exitosamente (5 clientes y 15 equipos).',
    demoClientsCount: demoClients.length,
    demoEquipmentsCount: demoEquipments.length
  });
});

app.post('/api/demo/clear', (req, res) => {
  let clients = readJson(CLIENTS_FILE, []);
  let equipments = readJson(EQUIPMENTS_FILE, []);

  // Remove ONLY demo data; preserve all real records
  const initialClientCount = clients.length;
  const initialEquipmentCount = equipments.length;

  clients = clients.filter(c => !c.isDemo);
  equipments = equipments.filter(e => !e.isDemo);

  writeJson(CLIENTS_FILE, clients);
  writeJson(EQUIPMENTS_FILE, equipments);

  res.json({
    message: 'Datos de demostración eliminados. Se conservaron todos los registros reales del sistema.',
    clientsRemoved: initialClientCount - clients.length,
    equipmentsRemoved: initialEquipmentCount - equipments.length,
    remainingClients: clients.length,
    remainingEquipments: equipments.length
  });
});

app.post('/api/demo/reset-horometers', (req, res) => {
  let clients = readJson(CLIENTS_FILE, []);
  let equipments = readJson(EQUIPMENTS_FILE, []);

  // Filter out existing demo equipments and replace with fresh DEMO_EQUIPMENTS
  const realEquipments = equipments.filter(e => !e.isDemo);
  const updatedEquipments = [...realEquipments, ...DEMO_EQUIPMENTS.map(d => ({ ...d }))];

  // Ensure demo clients exist
  DEMO_CLIENTS.forEach(demoClient => {
    if (!clients.some(c => c.id === demoClient.id || c.name.toLowerCase() === demoClient.name.toLowerCase())) {
      clients.push({ ...demoClient });
    }
  });

  writeJson(CLIENTS_FILE, clients);
  writeJson(EQUIPMENTS_FILE, updatedEquipments);

  res.json({
    message: 'Datos de demostración del módulo de Horómetros reiniciados a sus estados óptimos de simulación.',
    demoEquipmentsCount: DEMO_EQUIPMENTS.length,
    realEquipmentsCount: realEquipments.length
  });
});

// --- Maintenance Plans Endpoints ---
app.get('/api/plans', (req, res) => {
  const plans = readJson(PLANS_FILE, { allTasks: [], defaultPlans: {}, customModelPlans: {} });
  res.json(plans);
});

app.put('/api/plans', (req, res) => {
  writeJson(PLANS_FILE, req.body);
  res.json({ message: 'Planes actualizados exitosamente' });
});

// --- Google Sheets Webhook Integration Helper ---
async function syncReportToGoogleSheets(report) {
  try {
    if (!report) return null;
    // Strict isolation: Never sync demo reports to Google Sheets
    if (report.isDemo || (report.client && report.client.toLowerCase().includes('demo'))) {
      console.log(`[Google Sheets Sync] Omitiendo sincronización: reporte de demostración (${report.reportNumber || 'DEMO'}).`);
      return null;
    }

    const settings = readJson(SETTINGS_FILE, { googleSheetsWebhookUrl: '', autoSyncSheets: true });
    if (!settings.googleSheetsWebhookUrl || !settings.googleSheetsWebhookUrl.trim()) return null;
    if (settings.autoSyncSheets === false) return null;

    // Call Apps Script Webhook
    const res = await fetch(settings.googleSheetsWebhookUrl.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sync_report',
        report: report
      })
    });
    const data = await res.json();
    return data;
  } catch (err) {
    console.warn('[Google Sheets Sync] Aviso: no se pudo sincronizar reporte:', err.message);
    return null;
  }
}

async function deleteReportFromGoogleSheets(report) {
  try {
    if (!report) return null;
    if (report.isDemo || (report.client && report.client.toLowerCase().includes('demo'))) {
      return null;
    }

    const settings = readJson(SETTINGS_FILE, { googleSheetsWebhookUrl: '', autoSyncSheets: true });
    if (!settings.googleSheetsWebhookUrl || !settings.googleSheetsWebhookUrl.trim()) return null;
    if (settings.autoSyncSheets === false) return null;

    const res = await fetch(settings.googleSheetsWebhookUrl.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'delete_report',
        reportId: report.id,
        reportNumber: report.reportNumber
      })
    });
    const data = await res.json();
    return data;
  } catch (err) {
    console.warn('[Google Sheets Sync] Aviso: no se pudo sincronizar eliminación en Google Sheets:', err.message);
    return null;
  }
}

// Settings endpoints
app.get('/api/settings', (req, res) => {
  const settings = readJson(SETTINGS_FILE, {
    googleSheetsWebhookUrl: '',
    autoSyncSheets: true,
    lastSyncTime: null
  });
  res.json(settings);
});

app.put('/api/settings', (req, res) => {
  const current = readJson(SETTINGS_FILE, {
    googleSheetsWebhookUrl: '',
    autoSyncSheets: true,
    lastSyncTime: null
  });
  const updated = { ...current, ...req.body };
  writeJson(SETTINGS_FILE, updated);
  res.json({ message: 'Configuración guardada exitosamente.', settings: updated });
});

// Test connection to Google Sheets Webhook
app.post('/api/google-sheets/test', async (req, res) => {
  try {
    const url = req.body.url || (readJson(SETTINGS_FILE, {}).googleSheetsWebhookUrl);
    if (!url || !url.trim()) {
      return res.status(400).json({ error: 'Debe ingresar una URL de Webhook de Google Apps Script válida.' });
    }

    const response = await fetch(url.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test_connection' })
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error al conectar con Google Sheets: ' + err.message });
  }
});

// Sync all existing reports to Google Sheets
app.post('/api/google-sheets/sync-all', async (req, res) => {
  try {
    const settings = readJson(SETTINGS_FILE, {});
    const url = settings.googleSheetsWebhookUrl;
    if (!url || !url.trim()) {
      return res.status(400).json({ error: 'Configure primero la URL del Webhook de Google Sheets.' });
    }

    const reports = readJson(REPORTS_FILE, []).filter(r => !r.isDemo && !(r.client && r.client.toLowerCase().includes('demo')));
    const equipments = readJson(EQUIPMENTS_FILE, []).filter(e => !e.isDemo);
    const clients = readJson(CLIENTS_FILE, []).filter(c => !c.isDemo);

    // 1. Sync Catalog
    await fetch(url.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync_equipments', equipments })
    }).catch(e => console.warn(e));

    await fetch(url.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync_clients', clients })
    }).catch(e => console.warn(e));

    // 2. Sync Reports
    let syncedCount = 0;
    for (const rep of reports) {
      await fetch(url.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync_report', report: rep })
      }).catch(e => console.warn(e));
      syncedCount++;
    }

    settings.lastSyncTime = new Date().toISOString();
    writeJson(SETTINGS_FILE, settings);

    res.json({
      message: `¡Sincronización completa! Se enviaron ${syncedCount} reportes, ${equipments.length} equipos y ${clients.length} clientes a Google Sheets.`,
      syncedReports: syncedCount,
      syncedEquipments: equipments.length,
      syncedClients: clients.length
    });
  } catch (err) {
    res.status(500).json({ error: 'Error durante la sincronización total: ' + err.message });
  }
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html for SPA (Express 5 compatible)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server (only when not running as a Vercel serverless function)
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[INDUSTRAC] Servidor iniciado exitosamente en http://localhost:${PORT}`);
  });
}

module.exports = app;
