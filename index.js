// ============================================================================
// INDUSTRAC S.A.C. — SISTEMA DE REPORTES TÉCNICOS, EQUIPOS Y MANTENIMIENTO
// Backend Oficial: Node.js Express + Supabase PostgreSQL
// Compatible con: Vercel Serverless, Node.js local y Google Drive Oficial
// ============================================================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const db = require('./db/supabase');
const {
  authenticateUser,
  createSessionToken,
  verifySessionToken,
  requireAuth,
  optionalAuth,
  getCookieOptions
} = require('./auth/session');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware de seguridad y parsing
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Anti-caching middleware estricto (Evita que la CDN o navegadores devuelvan datos desactualizados)
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

// Directorio temporal o local de PDFs
const PDFS_DIR = path.join(__dirname, 'data', 'pdfs');
try {
  if (!fs.existsSync(PDFS_DIR)) {
    fs.mkdirSync(PDFS_DIR, { recursive: true });
  }
} catch (e) { }

// Alias para compatibilidad de nomenclatura interna
const authorizeWrite = requireAuth;

// ----------------------------------------------------------------------------
// HELPERS DE CÁLCULO INDUSTRIAL Y PROGRAMACIÓN DE MANTENIMIENTO
// ----------------------------------------------------------------------------

function addCalendarMonths(dateStr, monthsToAdd = 3) {
  if (!dateStr) return null;
  const parts = String(dateStr).split('T')[0].split('-');
  if (parts.length < 3) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
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
    return 'Plan C — 12000 horas';
  } else {
    const rem = m % 8000;
    if (rem === 2000) return 'Plan A — 2000 horas';
    if (rem === 4000) return 'Plan B — 4000 horas';
    if (rem === 6000) return 'Plan A — 2000 horas';
    return 'Plan C — 8000 horas';
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

  const history = Array.isArray(equipment.readingsHistory) ? [...equipment.readingsHistory] : [];
  const maintHistory = history
    .filter(h => (h.type === 'mantenimiento' || h.type === 'maintenance' || h.plan) && h.type !== 'reading')
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0) || (Number(a.hourMeter || 0) - Number(b.hourMeter || 0)));

  if (isCycle3k) {
    const step = 3000;
    const nextMilestoneHours = (Math.floor(lastHours / step) + 1) * step;

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
  const currentHours = Number(equipment.hourMeter !== undefined && equipment.hourMeter !== null && equipment.hourMeter !== '' ? equipment.hourMeter : (equipment.hours || 0)) || 0;

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

  const history = Array.isArray(equipment.readingsHistory) ? equipment.readingsHistory : [];
  const latestHistoryEntry = history.length > 0 ? history[0] : null;

  let lastHoro = null;
  if (lastMaintHours !== null) {
    lastHoro = lastMaintHours;
  } else if (currentHours > 0) {
    lastHoro = currentHours;
  } else if (latestHistoryEntry && (latestHistoryEntry.hourMeter !== undefined || latestHistoryEntry.hours !== undefined)) {
    lastHoro = Number(latestHistoryEntry.hourMeter !== undefined ? latestHistoryEntry.hourMeter : latestHistoryEntry.hours);
  }

  let lastReadingDate = lastMaintDate || equipment.lastReadingDate || (latestHistoryEntry ? latestHistoryEntry.date : null);

  if (nextMilestone === null) {
    if (lastMaintHours !== null) {
      nextMilestone = seq.nextMilestoneHours || computeNextMilestoneHours(lastMaintHours, cycle);
    } else if (currentHours > 0) {
      nextMilestone = computeNextMilestoneHours(currentHours, cycle);
    }
  }
  if (!nextPlan && nextMilestone !== null) {
    nextPlan = seq.nextPlan || getPlanForMilestone(nextMilestone, cycle);
  }
  if (!nextServiceType || nextServiceType === 'PENDIENTE DE CONFIGURACIÓN') {
    if (nextMilestone !== null) {
      nextServiceType = formatMaintenanceTypeLabel(nextMilestone) || `${nextMilestone.toLocaleString('en-US')} h`;
    }
  }

  if (!lastMaintenanceType && currentHours > 0) {
    const prevMilestone = Math.floor(currentHours / step) * step;
    if (prevMilestone > 0) {
      const prevPlan = getPlanForMilestone(prevMilestone, cycle);
      lastMaintenanceType = formatMaintenanceTypeLabel(prevPlan) || formatMaintenanceTypeLabel(prevMilestone) || `${prevMilestone.toLocaleString('en-US')} h`;
    }
  }

  const hasHistoryOrConfig = (lastMaintHours !== null && lastMaintDate) || nextMilestone !== null || currentHours > 0 || history.length > 0;

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
      lastHoro: null,
      lastReadingDate: null,
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
  const quarterlyEstimatedDate = lastMaintDate
    ? addCalendarMonths(lastMaintDate, 3)
    : (lastReadingDate ? addCalendarMonths(lastReadingDate, 3) : null);

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
    alertReason = `Vencido por horas (${Math.abs(hoursRemaining)} h exceso) y fecha (${Math.abs(daysUntilTrim)} días vencido).`;
    urgencyRank = 1;
    urgencyScore = 100 + Math.abs(hoursRemaining || 0);
  } else if (isHoursOverdue) {
    statusCode = 'overdue_hours';
    statusLabel = 'Vencido por horómetro';
    simplifiedStatus = 'VENCIDO';
    statusColor = 'crimson';
    statusIcon = '⛔';
    alertReason = `Horómetro superó el hito por ${Math.abs(hoursRemaining)} horas.`;
    urgencyRank = 2;
    urgencyScore = 90 + Math.abs(hoursRemaining || 0);
  } else if (isDateOverdue) {
    statusCode = 'overdue_date';
    statusLabel = 'Vencido por fecha trimestral';
    simplifiedStatus = 'VENCIDO';
    statusColor = 'red';
    statusIcon = '🔴';
    alertReason = `Fecha trimestral superada por ${Math.abs(daysUntilTrim)} días.`;
    urgencyRank = 3;
    urgencyScore = 80 + Math.abs(daysUntilTrim || 0);
  } else if (isHoursNear && isDateNear) {
    statusCode = 'near_both';
    statusLabel = 'Próximo por ambos criterios';
    simplifiedStatus = 'POR VENCER';
    statusColor = 'orange';
    statusIcon = '🟠';
    alertReason = `Próximo por horas (${hoursRemaining} h restantes) y fecha (${daysUntilTrim} días restantes).`;
    urgencyRank = 4;
    urgencyScore = 60 + (alertThreshold - (hoursRemaining || 0));
  } else if (isHoursNear) {
    statusCode = 'near_hours';
    statusLabel = 'Próximo por horómetro';
    simplifiedStatus = 'POR VENCER';
    statusColor = 'orange';
    statusIcon = '🟠';
    alertReason = `Quedan ${hoursRemaining} horas para el hito de ${nextMilestone} h.`;
    urgencyRank = 5;
    urgencyScore = 50 + (alertThreshold - (hoursRemaining || 0));
  } else if (isDateNear) {
    statusCode = 'near_date';
    statusLabel = 'Próximo por fecha trimestral';
    simplifiedStatus = 'POR VENCER';
    statusColor = 'amber';
    statusIcon = '🟡';
    alertReason = `Quedan ${daysUntilTrim} días para la fecha trimestral programada.`;
    urgencyRank = 6;
    urgencyScore = 40 + (15 - (daysUntilTrim || 0));
  } else {
    alertReason = hoursRemaining !== null ? `Operando normal. Faltan ${hoursRemaining} h.` : 'Operando dentro de parámetros normales.';
    urgencyRank = 7;
    urgencyScore = 0;
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
    currentHours,
    lastHoro,
    lastReadingDate,
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
    isConfigPending: false,
    cycle,
    alertThreshold,
    multipleMilestonesWarning,
    alertReason,
    daysUntilTrim,
    urgencyRank,
    urgencyScore
  };
}

function matchReportToEquipment(report, equipments) {
  if (!report || !Array.isArray(equipments) || equipments.length === 0) return -1;

  if (report.equipmentId) {
    const idx = equipments.findIndex(e => e.id === report.equipmentId);
    if (idx !== -1) return idx;
  }

  const clean = str => (str || '').toLowerCase().replace(/[\s\.\-_]/g, '');

  if (report.apiCode) {
    const rApi = clean(report.apiCode);
    const idx = equipments.findIndex(e => clean(e.apiCode) === rApi || clean(e.serialNumber) === rApi);
    if (idx !== -1) return idx;
  }

  if (report.serialNumber) {
    const rSn = clean(report.serialNumber);
    const idx = equipments.findIndex(e => clean(e.serialNumber) === rSn || clean(e.apiCode) === rSn);
    if (idx !== -1) return idx;
  }

  if (report.client && report.model) {
    const rCli = clean(report.client);
    const rMod = clean(report.model);
    const idx = equipments.findIndex(e => clean(e.client) === rCli && clean(e.model) === rMod);
    if (idx !== -1) return idx;
  }

  return -1;
}

function generateReportPdfFileName(report) {
  if (!report) return 'Reporte_Servicio.pdf';
  const clean = str => (str || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  const repNum = clean(report.reportNumber || 'REP');
  const client = clean(report.client || 'CLIENTE');
  const model = clean(report.model || 'EQUIPO');
  return `${repNum}_${client}_${model}.pdf`;
}

async function applyReportToEquipmentHorometer(report) {
  if (!report || report.status !== 'Finalizado') {
    return { success: false, reason: 'El reporte no tiene estado Finalizado.' };
  }

  try {
    const equipments = await db.getEquipments();
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

    const repId = report.id || '';
    const existingIdx = eq.readingsHistory.findIndex(h =>
      (repId && (h.reportId === repId || h.id === repId || h.id === `hist-boot-${repId}`)) ||
      (repNumber && h.reportNumber === repNumber)
    );

    const histEntry = {
      id: existingIdx !== -1 ? eq.readingsHistory[existingIdx].id : `maint-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      reportId: repId,
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

    let horometerUpdated = false;
    if (validHour && repHourMeter >= currentEqHours && !isOlderDate) {
      eq.hourMeter = String(repHourMeter);
      eq.hours = repHourMeter;
      eq.lastReadingDate = repDate;
      horometerUpdated = true;
    }

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

    const allReadings = eq.readingsHistory.slice().sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    if (allReadings.length > 0 && allReadings[0].date) {
      if (!eq.lastReadingDate || new Date(allReadings[0].date) >= new Date(eq.lastReadingDate)) {
        eq.lastReadingDate = allReadings[0].date;
      }
    }

    const seq = determineNextMaintenancePlan(eq, eq.lastMaintenance);
    eq.nextMaintenance = {
      milestoneHours: seq.nextMilestoneHours,
      plan: seq.nextPlan
    };
    eq.updatedAt = new Date().toISOString();

    await db.updateEquipment(eq.id, eq);

    return {
      success: true,
      equipmentId: eq.id,
      equipmentName: `${eq.client} — ${eq.model} [${eq.apiCode || eq.serialNumber}]`,
      horometerUpdated,
      newHorometer: eq.hourMeter,
      previousHorometer: currentEqHours
    };
  } catch (err) {
    console.error('[Horometers] Error al aplicar reporte al equipo:', err);
    return { success: false, reason: err.message };
  }
}

// ----------------------------------------------------------------------------
// API ROUTES — AUTENTICACIÓN Y SEGURIDAD DE ACCESO
// ----------------------------------------------------------------------------

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const forwarded = req.headers['x-forwarded-for'];
    const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null) || req.ip || req.socket?.remoteAddress || '127.0.0.1';
    const authResult = await authenticateUser(email, password, ip);

    if (!authResult.ok) {
      return res.status(authResult.rateLimited ? 429 : 401).json({
        ok: false,
        error: authResult.error
      });
    }

    const token = createSessionToken(authResult.user);
    res.cookie('industrac_session', token, getCookieOptions());
    return res.json({
      ok: true,
      message: 'Inicio de sesión exitoso',
      user: authResult.user,
      token
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Error interno de autenticación: ' + err.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('industrac_session', { path: '/' });
  return res.json({ ok: true, message: 'Sesión cerrada correctamente.' });
});

app.get('/api/auth/me', optionalAuth, (req, res) => {
  if (req.user) {
    return res.json({
      authenticated: true,
      user: req.user,
      token: req.sessionToken || null
    });
  }
  return res.json({
    authenticated: false,
    user: null
  });
});

// ----------------------------------------------------------------------------
// API ROUTES — DIAGNÓSTICO Y SALUD
// ----------------------------------------------------------------------------

app.get('/api/health', async (req, res) => {
  try {
    const conn = await db.testConnection();
    const hasSecretKey = Boolean(
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_KEY ||
      process.env.SUPABASE_SECRET ||
      process.env.SUPABASE_SERVICE_KEY
    );
    const missingVars = [];
    if (!process.env.SUPABASE_URL) missingVars.push('SUPABASE_URL');
    if (!hasSecretKey) missingVars.push('SUPABASE_SECRET_KEY');
    if (!process.env.API_SECRET_KEY) missingVars.push('API_SECRET_KEY');

    res.json({
      status: 'ok',
      engine: 'Supabase PostgreSQL',
      supabaseConfigured: Boolean(process.env.SUPABASE_URL && hasSecretKey),
      supabaseConnected: conn.ok,
      missingVars,
      error: conn.error || null,
      environment: process.env.VERCEL ? 'vercel-serverless' : 'local',
      serverTime: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ----------------------------------------------------------------------------
// API ROUTES — NUMERACIÓN ATÓMICA DE REPORTES
// ----------------------------------------------------------------------------

app.get(['/api/next-report-number', '/api/reports/next-number'], requireAuth, async (req, res) => {
  try {
    const peek = req.query.peek !== 'false';
    const number = await db.getNextReportNumber(peek);
    res.json({ reportNumber: number });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al generar número de reporte: ' + err.message });
  }
});

// ----------------------------------------------------------------------------
// API ROUTES — REPORTES
// ----------------------------------------------------------------------------

app.get('/api/reports', requireAuth, async (req, res) => {
  try {
    const { status, summary } = req.query;
    const reports = await db.getReports({ status, summary });
    res.json(reports);
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al consultar reportes: ' + err.message });
  }
});

app.get('/api/reports/:id', requireAuth, async (req, res) => {
  try {
    const report = await db.getReportById(req.params.id);
    if (!report) {
      return res.status(404).json({ error: 'Reporte no encontrado' });
    }
    res.json(report);
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al obtener reporte: ' + err.message });
  }
});

app.post('/api/reports', authorizeWrite, async (req, res) => {
  try {
    const reportData = req.body;
    const clientName = (reportData.client || '').trim();
    if (!clientName) {
      return res.status(400).json({ error: 'El nombre del cliente es obligatorio para registrar un reporte.' });
    }

    // Idempotencia: Si ya existe un reporte con ese ID o número, actualizarlo
    if (reportData.id) {
      const existing = await db.getReportById(reportData.id);
      if (existing) {
        const updated = await db.updateReport(reportData.id, reportData);
        let horometerUpdate = null;
        if (updated.status === 'Finalizado') {
          horometerUpdate = await applyReportToEquipmentHorometer(updated);
        }
        return res.status(200).json({ ...updated, horometerUpdate, idempotent: true });
      }
    }

    // Si el número de reporte no viene definido o es un placeholder, generar el correlativo oficial consumiéndolo
    let reportNumber = (reportData.reportNumber || '').trim();
    if (!reportNumber || reportNumber === 'AUTO' || reportNumber.startsWith('REP-2026-...')) {
      reportNumber = await db.getNextReportNumber(false);
    }

    const newReport = {
      ...reportData,
      id: reportData.id || `rep-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      reportNumber,
      status: reportData.status || 'Finalizado'
    };

    const saved = await db.createReport(newReport);
    let horometerUpdate = null;
    if (saved.status === 'Finalizado') {
      horometerUpdate = await applyReportToEquipmentHorometer(saved);
    }

    res.status(201).json({ ...saved, horometerUpdate });
  } catch (err) {
    console.error('[Reports] Error al crear reporte:', err);
    res.status(err.status || 500).json({ error: 'Error al guardar reporte: ' + err.message });
  }
});

app.put('/api/reports/:id', authorizeWrite, async (req, res) => {
  try {
    const existing = await db.getReportById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Reporte no encontrado en la base de datos.' });
    }

    const updated = await db.updateReport(req.params.id, req.body);
    let horometerUpdate = null;
    if (updated.status === 'Finalizado') {
      horometerUpdate = await applyReportToEquipmentHorometer(updated);
    }

    res.json({ ...updated, horometerUpdate });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al actualizar reporte: ' + err.message });
  }
});

app.delete('/api/reports/:id', authorizeWrite, async (req, res) => {
  try {
    const rawId = req.params.id ? String(req.params.id).trim() : '';
    if (!rawId) {
      return res.status(400).json({ error: 'ID de reporte inválido o vacío' });
    }

    const existing = await db.getReportById(rawId);
    if (!existing) {
      return res.status(404).json({ error: 'Reporte no encontrado en la base de datos.' });
    }

    await db.deleteReport(existing.id);

    // Eliminar archivo PDF temporal si existe
    try {
      const pdfPath = path.join(PDFS_DIR, `${existing.id}.pdf`);
      if (fs.existsSync(pdfPath)) {
        fs.unlinkSync(pdfPath);
      }
    } catch (e) { }

    res.json({ success: true, message: 'Reporte eliminado exitosamente de Supabase.' });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al eliminar reporte: ' + err.message });
  }
});

// ----------------------------------------------------------------------------
// API ROUTES — GENERACIÓN DE PDF Y SUBIDA A GOOGLE DRIVE
// ----------------------------------------------------------------------------

app.post('/api/reports/:id/pdf', requireAuth, async (req, res) => {
  try {
    const { pdfBase64, fileName: requestedFileName } = req.body;

    if (!pdfBase64) {
      return res.status(400).json({ error: 'Se requiere el contenido del PDF en formato base64.' });
    }

    const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '').trim();
    const buffer = Buffer.from(cleanBase64, 'base64');

    const safeId = path.basename(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(PDFS_DIR, `${safeId}.pdf`);

    try {
      if (!fs.existsSync(PDFS_DIR)) {
        fs.mkdirSync(PDFS_DIR, { recursive: true });
      }
      fs.writeFileSync(filePath, buffer);
    } catch (fsErr) {
      try {
        fs.writeFileSync(path.join('/tmp', `${safeId}.pdf`), buffer);
      } catch (tmpErr) { }
    }

    const report = await db.getReportById(req.params.id);
    const fileName = requestedFileName || generateReportPdfFileName(report);

    let driveResult = null;
    const driveWebhookUrl = (process.env.GOOGLE_DRIVE_WEBHOOK_URL || process.env.GOOGLE_SHEETS_WEBHOOK_URL || '').trim();

    if (driveWebhookUrl) {
      try {
        const repNum = report && report.reportNumber ? report.reportNumber : req.params.id;
        console.log(`[Google Drive] Subiendo PDF "${fileName}" al Drive corporativo...`);

        const driveRes = await fetch(driveWebhookUrl, {
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
            await db.updateReportDriveUrls(req.params.id, driveData.driveViewUrl, driveData.driveDownloadUrl);
          }
        } else {
          console.warn('[Google Drive] Respuesta de Apps Script:', driveData);
        }
      } catch (eDrive) {
        console.warn('[Google Drive] Aviso: no se pudo sincronizar a Google Drive:', eDrive.message);
      }
    }

    res.json({
      message: driveResult ? 'PDF guardado exitosamente en Google Drive' : 'PDF procesado exitosamente',
      fileName: fileName,
      downloadUrl: `/api/reports/${req.params.id}/pdf`,
      driveUrl: driveResult?.driveViewUrl || (report?.pdfDriveUrl || null),
      driveDownloadUrl: driveResult?.driveDownloadUrl || (report?.pdfDriveDownloadUrl || null)
    });
  } catch (err) {
    console.error('Error guardando PDF:', err);
    res.status(500).json({ error: 'Error al procesar archivo PDF: ' + err.message });
  }
});

app.get('/api/reports/:id/pdf', requireAuth, async (req, res) => {
  const safeId = path.basename(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(PDFS_DIR, `${safeId}.pdf`);

  let targetPath = filePath;
  if (!fs.existsSync(filePath)) {
    const tmpPath = path.join('/tmp', `${safeId}.pdf`);
    if (fs.existsSync(tmpPath)) {
      targetPath = tmpPath;
    } else {
      return res.status(404).send('Archivo PDF no encontrado en el servidor. Debe generarlo previamente.');
    }
  }

  const report = await db.getReportById(req.params.id);
  const downloadName = generateReportPdfFileName(report);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
  res.sendFile(targetPath);
});

app.get('/api/reports/:id/pdf-view', (req, res) => {
  const safeId = path.basename(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(PDFS_DIR, `${safeId}.pdf`);

  let targetPath = filePath;
  if (!fs.existsSync(filePath)) {
    const tmpPath = path.join('/tmp', `${safeId}.pdf`);
    if (fs.existsSync(tmpPath)) {
      targetPath = tmpPath;
    } else {
      return res.status(404).send('Archivo PDF no encontrado en el servidor.');
    }
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline');
  res.sendFile(targetPath);
});

// ----------------------------------------------------------------------------
// API ROUTES — CLIENTES
// ----------------------------------------------------------------------------

app.get('/api/clients', requireAuth, async (req, res) => {
  try {
    const clients = await db.getClients();
    res.json(clients);
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al obtener clientes: ' + err.message });
  }
});

app.post('/api/clients', authorizeWrite, async (req, res) => {
  try {
    const { name, address, contact, notes, isDemo } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });
    }

    const newClient = {
      id: req.body.id || `cli-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      name: name.trim(),
      address: address ? address.trim() : '',
      contact: contact ? contact.trim() : '',
      notes: notes ? notes.trim() : '',
      isDemo: Boolean(isDemo)
    };

    const saved = await db.createClient(newClient);
    res.status(201).json({ message: 'Cliente registrado exitosamente en Supabase.', client: saved });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al registrar cliente: ' + err.message });
  }
});

app.put('/api/clients/:id', authorizeWrite, async (req, res) => {
  try {
    const { name, address, contact, notes, isDemo } = req.body;
    const existing = await db.getClientById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Cliente no encontrado en Supabase.' });
    }

    const updated = await db.updateClient(req.params.id, {
      ...existing,
      name: name !== undefined ? name.trim() : existing.name,
      address: address !== undefined ? address.trim() : existing.address,
      contact: contact !== undefined ? contact.trim() : existing.contact,
      notes: notes !== undefined ? notes.trim() : existing.notes,
      isDemo: isDemo !== undefined ? Boolean(isDemo) : existing.isDemo
    });

    res.json({ message: 'Cliente actualizado exitosamente.', client: updated });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al actualizar cliente: ' + err.message });
  }
});

app.delete('/api/clients/:id', authorizeWrite, async (req, res) => {
  try {
    const existing = await db.getClientById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Cliente no encontrado en Supabase.' });
    }

    await db.deleteClient(req.params.id);

    // Si se solicitó eliminar equipos asociados
    if (req.query.removeEquipments === 'true') {
      const equipments = await db.getEquipments();
      const clientEqs = equipments.filter(e => e.clientId === req.params.id);
      for (const eq of clientEqs) {
        await db.deleteEquipment(eq.id);
      }
    }

    res.json({ success: true, message: 'Cliente eliminado exitosamente.' });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al eliminar cliente: ' + err.message });
  }
});

// ----------------------------------------------------------------------------
// API ROUTES — EQUIPOS
// ----------------------------------------------------------------------------

app.get('/api/equipments', requireAuth, async (req, res) => {
  try {
    const equipments = await db.getEquipments();
    res.json(equipments);
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al obtener equipos: ' + err.message });
  }
});

app.get('/api/equipments/:id', requireAuth, async (req, res) => {
  try {
    const eq = await db.getEquipmentById(req.params.id);
    if (!eq) {
      return res.status(404).json({ error: 'Equipo no encontrado en Supabase.' });
    }
    res.json(eq);
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al consultar equipo: ' + err.message });
  }
});

app.get('/api/equipments/:id/reports', requireAuth, async (req, res) => {
  try {
    const eq = await db.getEquipmentById(req.params.id);
    if (!eq) {
      return res.status(404).json({ error: 'Equipo no encontrado.' });
    }

    const reports = await db.getReports({ status: 'Finalizado' });
    const clean = str => (str || '').toLowerCase().replace(/[\s\.\-_]/g, '');

    const filtered = reports.filter(r =>
      r.equipmentId === eq.id ||
      (r.apiCode && clean(r.apiCode) === clean(eq.apiCode)) ||
      (r.serialNumber && clean(r.serialNumber) === clean(eq.serialNumber)) ||
      (clean(r.client) === clean(eq.client) && clean(r.model) === clean(eq.model))
    );

    res.json(filtered);
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al obtener reportes del equipo: ' + err.message });
  }
});

app.post('/api/equipments', authorizeWrite, async (req, res) => {
  try {
    const { model, client, clientId } = req.body;
    if (!model || !model.trim() || !client || !client.trim()) {
      return res.status(400).json({ error: 'El Modelo y el Cliente son obligatorios para registrar un equipo.' });
    }

    const newEquipment = {
      ...req.body,
      id: req.body.id || `eq-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      model: model.trim(),
      client: client.trim(),
      clientId: clientId || null,
      status: req.body.status || 'Activo',
      active: req.body.active !== false
    };

    const seq = determineNextMaintenancePlan(newEquipment);
    if (!newEquipment.nextMaintenance || !newEquipment.nextMaintenance.milestoneHours) {
      newEquipment.nextMaintenance = {
        milestoneHours: seq.nextMilestoneHours,
        plan: seq.nextPlan
      };
    }

    const saved = await db.createEquipment(newEquipment);
    res.status(201).json({ message: 'Equipo registrado exitosamente en Supabase.', equipment: saved });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al registrar equipo: ' + err.message });
  }
});

app.put('/api/equipments/:id', authorizeWrite, async (req, res) => {
  try {
    const existing = await db.getEquipmentById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Equipo no encontrado en Supabase.' });
    }

    const updatedData = {
      ...existing,
      ...req.body,
      id: existing.id
    };

    const seq = determineNextMaintenancePlan(updatedData, updatedData.lastMaintenance);
    if (!req.body.nextMaintenance || !req.body.nextMaintenance.milestoneHours) {
      updatedData.nextMaintenance = {
        milestoneHours: seq.nextMilestoneHours || existing.nextMaintenance?.milestoneHours,
        plan: seq.nextPlan || existing.nextMaintenance?.plan
      };
    }

    const saved = await db.updateEquipment(req.params.id, updatedData);
    res.json({ message: 'Equipo actualizado exitosamente.', equipment: saved });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al actualizar equipo: ' + err.message });
  }
});

app.patch('/api/equipments/:id/status', authorizeWrite, async (req, res) => {
  try {
    const existing = await db.getEquipmentById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Equipo no encontrado.' });
    }

    const newStatus = req.body.status || (existing.status === 'Activo' ? 'Inactivo' : 'Activo');
    const updated = await db.updateEquipment(req.params.id, {
      ...existing,
      status: newStatus,
      active: newStatus === 'Activo'
    });

    res.json({ message: `Estado actualizado a "${newStatus}".`, equipment: updated });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al cambiar estado: ' + err.message });
  }
});

app.delete('/api/equipments/:id', authorizeWrite, async (req, res) => {
  try {
    const existing = await db.getEquipmentById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Equipo no encontrado en Supabase.' });
    }

    await db.deleteEquipment(req.params.id);
    res.json({ success: true, message: 'Equipo eliminado exitosamente.' });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al eliminar equipo: ' + err.message });
  }
});

// ----------------------------------------------------------------------------
// API ROUTES — HORÓMETROS Y REGISTROS DE LECTURAS
// ----------------------------------------------------------------------------

app.post('/api/equipments/:id/readings', authorizeWrite, async (req, res) => {
  try {
    const eq = await db.getEquipmentById(req.params.id);
    if (!eq) {
      return res.status(404).json({ error: 'Equipo no encontrado en Supabase.' });
    }

    const newHours = Number(req.body.hourMeter !== undefined ? req.body.hourMeter : req.body.hours);
    const readingDate = req.body.date || new Date().toISOString().split('T')[0];
    const notes = (req.body.notes || '').trim();
    const user = (req.body.user || req.body.registeredBy || 'Administrador').trim();

    if (isNaN(newHours) || newHours < 0) {
      return res.status(400).json({ error: 'La lectura del horómetro debe ser un número positivo mayor o igual a 0.' });
    }

    const updated = await db.addEquipmentReading(req.params.id, {
      date: readingDate,
      hourMeter: newHours,
      hours: newHours,
      type: 'reading',
      notes,
      user
    });

    const metrics = calculateEquipmentHorometerMetrics(updated);
    res.json({
      message: 'Lectura de horómetro registrada exitosamente.',
      equipment: updated,
      metrics
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al registrar lectura: ' + err.message });
  }
});

app.post('/api/equipments/:id/maintenance', authorizeWrite, async (req, res) => {
  try {
    const eq = await db.getEquipmentById(req.params.id);
    if (!eq) {
      return res.status(404).json({ error: 'Equipo no encontrado.' });
    }

    const maintDate = req.body.date || new Date().toISOString().split('T')[0];
    const rawHours = req.body.hourMeter !== undefined ? req.body.hourMeter : req.body.hours;
    const maintHours = Number(rawHours !== undefined && rawHours !== '' ? rawHours : (eq.hourMeter || eq.hours || 0));
    const plan = req.body.plan || 'Plan A — 2000 horas';
    const reportNumber = (req.body.reportNumber || '').trim();
    const notes = (req.body.notes || '').trim();
    const user = (req.body.user || req.body.technician || 'Técnico INDUSTRAC').trim();

    if (isNaN(maintHours) || maintHours < 0) {
      return res.status(400).json({ error: 'La lectura del horómetro en mantenimiento debe ser un número válido.' });
    }

    const updated = await db.addEquipmentReading(req.params.id, {
      date: maintDate,
      hourMeter: maintHours,
      hours: maintHours,
      type: 'mantenimiento',
      plan,
      reportNumber,
      notes,
      user
    });

    // Actualizar lastMaintenance y recalcular próximo hito
    updated.lastMaintenance = {
      date: maintDate,
      hourMeter: maintHours,
      plan: plan,
      reportNumber: reportNumber,
      notes: notes
    };

    const seq = determineNextMaintenancePlan(updated, updated.lastMaintenance);
    updated.nextMaintenance = {
      milestoneHours: seq.nextMilestoneHours,
      plan: seq.nextPlan
    };

    const finalSaved = await db.updateEquipment(req.params.id, updated);
    const metrics = calculateEquipmentHorometerMetrics(finalSaved);

    res.json({
      message: 'Mantenimiento registrado y ciclo avanzado con éxito.',
      equipment: finalSaved,
      metrics
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al registrar mantenimiento: ' + err.message });
  }
});

app.put('/api/equipments/:id/maintenance-config', authorizeWrite, async (req, res) => {
  try {
    const eq = await db.getEquipmentById(req.params.id);
    if (!eq) {
      return res.status(404).json({ error: 'Equipo no encontrado.' });
    }

    const maintenanceCycle = req.body.maintenanceCycle || req.body.cycleType;
    if (maintenanceCycle) {
      eq.maintenanceCycle = maintenanceCycle;
      eq.cycleType = maintenanceCycle;
    }

    const lastMaintenanceDate = req.body.lastMaintenanceDate || req.body.lastMaintDate;
    const lastMaintenanceHours = req.body.lastMaintenanceHours !== undefined ? req.body.lastMaintenanceHours : req.body.lastMaintHours;
    const lastMaintenancePlan = req.body.lastMaintenancePlan || req.body.lastPlan;

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
    let calcNextMilestone = req.body.nextMilestoneHours !== undefined && req.body.nextMilestoneHours !== null && req.body.nextMilestoneHours !== ''
      ? Number(req.body.nextMilestoneHours)
      : (eq.lastMaintenance?.hourMeter !== undefined ? computeNextMilestoneHours(eq.lastMaintenance.hourMeter, cycle) : null);

    let calcNextPlan = req.body.nextPlan || (calcNextMilestone !== null ? getPlanForMilestone(calcNextMilestone, cycle) : null);

    eq.nextMaintenance = {
      milestoneHours: calcNextMilestone,
      plan: calcNextPlan
    };

    if (req.body.monthlyAverageHours !== undefined) {
      eq.monthlyAverageHours = req.body.monthlyAverageHours !== null && req.body.monthlyAverageHours !== '' ? Number(req.body.monthlyAverageHours) : null;
    }
    if (req.body.alertThresholdHours !== undefined) {
      eq.alertThresholdHours = req.body.alertThresholdHours !== null && req.body.alertThresholdHours !== '' ? Number(req.body.alertThresholdHours) : 200;
    }
    if (req.body.currentHours !== undefined || req.body.hourMeter !== undefined) {
      const rawH = req.body.currentHours !== undefined ? req.body.currentHours : req.body.hourMeter;
      if (rawH !== null && rawH !== '') {
        eq.hourMeter = String(rawH);
        eq.hours = Number(rawH);
      }
    }

    const saved = await db.updateEquipment(req.params.id, eq);
    const metrics = calculateEquipmentHorometerMetrics(saved);

    res.json({
      message: 'Configuración de mantenimiento actualizada con éxito.',
      equipment: saved,
      metrics
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al actualizar configuración: ' + err.message });
  }
});

app.get('/api/equipments/:id/horometer-history', requireAuth, async (req, res) => {
  try {
    const eq = await db.getEquipmentById(req.params.id);
    if (!eq) {
      return res.status(404).json({ error: 'Equipo no encontrado.' });
    }
    res.json(eq.readingsHistory || []);
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al obtener historial: ' + err.message });
  }
});

app.delete('/api/equipments/:id/horometer', authorizeWrite, async (req, res) => {
  try {
    const eq = await db.getEquipmentById(req.params.id);
    if (!eq) {
      return res.status(404).json({ error: 'Equipo no encontrado.' });
    }

    eq.readingsHistory = [];
    eq.lastMaintenance = null;
    eq.nextMaintenance = null;
    eq.lastReadingDate = null;
    eq.hourMeter = '0';
    eq.hours = 0;

    const saved = await db.updateEquipment(req.params.id, eq);
    res.json({ success: true, message: 'Horómetro restablecido exitosamente.', equipment: saved });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al restablecer horómetro: ' + err.message });
  }
});

app.get('/api/horometers', requireAuth, async (req, res) => {
  try {
    const equipments = await db.getEquipments();
    const enriched = equipments.map(eq => {
      const metrics = calculateEquipmentHorometerMetrics(eq);
      return {
        ...eq,
        metrics
      };
    });

    let operational = 0;
    let overdueHours = 0;
    let overdueDate = 0;
    let overdueBoth = 0;
    let nearHours = 0;
    let nearDate = 0;
    let nearBoth = 0;
    let pendingConfig = 0;

    enriched.forEach(e => {
      switch (e.metrics.statusCode) {
        case 'up_to_date': operational++; break;
        case 'overdue_both': overdueBoth++; break;
        case 'overdue_hours': overdueHours++; break;
        case 'overdue_date': overdueDate++; break;
        case 'near_both': nearBoth++; break;
        case 'near_hours': nearHours++; break;
        case 'near_date': nearDate++; break;
        case 'pending_config': pendingConfig++; break;
      }
    });

    const overdueTotal = overdueBoth + overdueHours + overdueDate;
    const nearTotal = nearBoth + nearHours + nearDate;

    res.json({
      totalEquipments: equipments.length,
      operationalCount: operational,
      alertCount: nearTotal,
      expiredCount: overdueTotal,
      pendingDataCount: pendingConfig,
      summary: {
        upToDate: operational,
        nearHours,
        nearDate,
        nearBoth,
        overdueHours,
        overdueDate,
        overdueBoth,
        pendingConfig
      },
      equipments: enriched
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al cargar horómetros: ' + err.message });
  }
});

// ----------------------------------------------------------------------------
// API ROUTES — PLANES DE MANTENIMIENTO
// ----------------------------------------------------------------------------

app.get('/api/plans', async (req, res) => {
  try {
    const plans = await db.getMaintenancePlans();
    res.json(plans);
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al consultar planes: ' + err.message });
  }
});

app.put('/api/plans', authorizeWrite, async (req, res) => {
  try {
    const updated = await db.updateMaintenancePlans(req.body);
    res.json({ message: 'Planes de mantenimiento actualizados exitosamente en Supabase.', plans: updated });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Error al guardar planes: ' + err.message });
  }
});

// ----------------------------------------------------------------------------
// API ROUTES — CONFIGURACIÓN Y DESCONEXIÓN DE GOOGLE SHEETS
// ----------------------------------------------------------------------------

app.get('/api/settings', requireAuth, (req, res) => {
  res.json({
    supabaseDatabase: 'Conectado a PostgreSQL',
    googleDriveActive: true,
    googleSheetsStatus: 'Desactivado (Sustituido por Supabase PostgreSQL)'
  });
});

app.put('/api/settings', authorizeWrite, (req, res) => {
  res.json({
    message: 'Configuración actualizada.',
    supabaseDatabase: 'Conectado a PostgreSQL'
  });
});

app.post(['/api/settings/pull-sheets', '/api/google-sheets/test', '/api/google-sheets/sync-all'], (req, res) => {
  res.json({
    success: true,
    message: 'La integración con Google Sheets ha sido retirada de forma permanente. Toda la persistencia es administrada de manera segura por Supabase PostgreSQL.'
  });
});

// ----------------------------------------------------------------------------
// FRONTEND STATIC FILES & SPA FALLBACK
// ----------------------------------------------------------------------------

app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ----------------------------------------------------------------------------
// INICIO DEL SERVIDOR
// ----------------------------------------------------------------------------

if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[INDUSTRAC] Servidor iniciado exitosamente en http://localhost:${PORT}`);
    console.log(`[INDUSTRAC] Motor de persistencia activo: Supabase PostgreSQL`);
  });
}

module.exports = app;
