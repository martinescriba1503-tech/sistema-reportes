/**
 * ============================================================================
 * SCRIPT PARA GOOGLE SHEETS & GOOGLE DRIVE — INDUSTRAC S.A.C.
 * Sistema Inteligente de Reportes Técnicos
 * Carpeta en Google Drive: PDF_REPORTES2027
 * ============================================================================
 * 
 * INSTRUCCIONES DE INSTALACIÓN PASO A PASO (EN 2 MINUTOS):
 * 1. Abre tu hoja de Google Sheets (una hoja nueva o la existente para reportes).
 * 2. En el menú superior, haz clic en: Extensiones > Apps Script.
 * 3. Borra todo el código que aparezca y pega TODO este archivo completo.
 * 4. Haz clic en el icono "Guardar" (disco).
 * 5. Haz clic en el botón azul superior "Implementar" > "Nueva implementación".
 *    (Si ya tenías una implementada antes, ve a "Implementar" > "Administrar implementaciones" 
 *     > Icono de lápiz > En Versión elige "Nueva versión").
 * 6. En el engranaje (tipo rueda), selecciona "Aplicación web".
 * 7. Configura exactamente los siguientes campos:
 *    - Descripción: INDUSTRAC Sheets & Drive Webhook 2027
 *    - Ejecutar como: "Yo" (tu cuenta de Google)
 *    - Quién tiene acceso: "Cualquier usuario" (Anyone)   <--- OBLIGATORIO
 * 8. Haz clic en "Implementar" y autoriza los permisos de Google.
 *    (Google te pedirá autorizar acceso a Google Sheets y Google Drive).
 * 9. Copia la URL de la aplicación web generada (termina en /exec).
 * 10. En el sistema INDUSTRAC, abre el botón "Google Sheets > Configurar Conexión"
 *     y pega la URL copiada.
 * 
 * NOTA AUTOMÁTICA DE GOOGLE DRIVE:
 * La carpeta "PDF_REPORTES2027" se creará AUTOMÁTICAMENTE en tu Google Drive la primera vez
 * que se genere un reporte. Si ya creaste manualmente una carpeta llamada "PDF_REPORTES2027",
 * el script la detectará por el nombre y guardará allí directamente los archivos PDF.
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(30000); // Evitar colisiones de guardado simultáneo

  try {
    var rawData = e.postData.contents;
    var data = JSON.parse(rawData);
    var action = data.action || 'sync_report';
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. PING / TEST DE CONEXIÓN
    if (action === 'test_connection') {
      var folder = getOrCreateFolder(data.folderName || 'PDF_REPORTES2027');
      return responseJson({
        status: 'success',
        message: '¡Conexión establecida exitosamente con Google Sheets y Google Drive!',
        sheetName: ss.getName(),
        driveFolderName: folder.getName(),
        driveFolderUrl: folder.getUrl()
      });
    }

    // 2. SUBIR ARCHIVO PDF DIRECTAMENTE A GOOGLE DRIVE (Carpeta: PDF_REPORTES2027)
    if (action === 'upload_pdf_drive') {
      var folderName = data.folderName || 'PDF_REPORTES2027';
      var cleanBase64 = String(data.pdfBase64 || '').trim();
      if (cleanBase64.indexOf('base64,') !== -1) {
        cleanBase64 = cleanBase64.split('base64,')[1].trim();
      }

      if (!cleanBase64) {
        return responseJson({ status: 'error', message: 'No se envió contenido pdfBase64' });
      }

      var folder = getOrCreateFolder(folderName);
      var fileName = data.fileName || ('REP-' + (data.reportNumber || 'REPORTE') + '.pdf');
      var decodedBytes = Utilities.base64Decode(cleanBase64);
      var blob = Utilities.newBlob(decodedBytes, 'application/pdf', fileName);

      // Si ya existe un archivo con ese nombre en la carpeta, reemplazarlo limpiamente
      var existingFiles = folder.getFilesByName(fileName);
      while (existingFiles.hasNext()) {
        existingFiles.next().setTrashed(true);
      }
      var file = folder.createFile(blob);

      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (eShare) {
        // En dominios Google Workspace con restricciones organizacionales
      }

      var fileId = file.getId();
      var driveViewUrl = file.getUrl();
      var driveDownloadUrl = 'https://drive.google.com/uc?export=download&id=' + fileId;

      // Actualizar automáticamente la columna "Enlace PDF" en la hoja "Reportes Técnicos" si existe
      if (data.reportNumber) {
        try {
          var repSheet = ss.getSheetByName('Reportes Técnicos');
          if (repSheet) {
            var rowIdx = findRowByValue(repSheet, 1, data.reportNumber);
            if (rowIdx > 1) {
              // Columna 31 = 'Enlace PDF'
              repSheet.getRange(rowIdx, 31).setValue(driveDownloadUrl);
            }
          }
        } catch (eSheet) {}
      }

      return responseJson({
        status: 'success',
        message: 'PDF guardado exitosamente en Google Drive en carpeta ' + folderName,
        folderName: folderName,
        fileName: fileName,
        fileId: fileId,
        driveViewUrl: driveViewUrl,
        driveDownloadUrl: driveDownloadUrl
      });
    }

    // 3. SINCRONIZAR REPORTE TÉCNICO A GOOGLE SHEETS
    if (action === 'sync_report') {
      var sheet = getOrCreateSheet(ss, 'Reportes Técnicos', [
        'N° Reporte',
        'Fecha',
        'Estado',
        'Cliente',
        'Dirección / Planta',
        'Modelo Compresor',
        'API / ID Máquina',
        'Fabricante',
        'Técnico Responsable',
        'Tipo Servicio',
        'Plan / Horas',
        'Horómetro (hrs)',
        'Tipo Aceite',
        'Nivel Aceite',
        'Presión Carga (bar)',
        'Presión Descarga (bar)',
        'Temp. Salida Elemento (°C)',
        'Temp. Aceite (°C)',
        'Voltaje R-S',
        'Voltaje S-T',
        'Voltaje R-T',
        'Corriente L1 (A)',
        'Corriente L2 (A)',
        'Corriente L3 (A)',
        'Frecuencia (Hz)',
        'Repuestos Utilizados',
        'Observaciones / Conclusiones',
        'Firma Técnico',
        'Firma Cliente',
        'Fotos Adjuntas',
        'Enlace PDF (Google Drive)',
        'Fecha Registro'
      ]);

      var report = data.report || {};
      var reportNumber = report.reportNumber || 'REP-PENDIENTE';

      // Preparar repuestos como texto legible
      var partsSummary = '';
      if (report.partsReplaced && Array.isArray(report.partsReplaced)) {
        partsSummary = report.partsReplaced.map(function(p) {
          return (p.qty || 1) + 'x ' + (p.description || p.code || 'Repuesto');
        }).join('; ');
      }

      var pdfLink = report.pdfDriveDownloadUrl || report.pdfDriveUrl || report.pdfUrl || (report.id ? 'http://localhost:3000/api/reports/' + report.id + '/pdf' : '');

      var rowValues = [
        reportNumber,
        report.date || Utilities.formatDate(new Date(), 'GMT-5', 'yyyy-MM-dd'),
        report.status || 'Finalizado',
        report.client || '',
        report.address || '',
        report.model || '',
        report.apiCode || report.serialNumber || '',
        report.manufacturer || 'Atlas Copco',
        report.technician || '',
        report.serviceType || 'Mantenimiento',
        report.maintenanceType || '',
        report.hourMeter || 0,
        report.oilType || '',
        report.oilLevel || 'Alto',
        (report.regulations && report.regulations.loadPressure) || '',
        (report.regulations && report.regulations.unloadPressure) || '',
        (report.technicalParameters && report.technicalParameters.elem1Temp) || '',
        (report.technicalParameters && report.technicalParameters.oilTemp) || '',
        (report.electrical && report.electrical.u1_u2) || '',
        (report.electrical && report.electrical.u2_u3) || '',
        (report.electrical && report.electrical.u1_u3) || '',
        (report.electrical && report.electrical.i_l1) || '',
        (report.electrical && report.electrical.i_l2) || '',
        (report.electrical && report.electrical.i_l3) || '',
        (report.electrical && report.electrical.f1) || '',
        partsSummary,
        report.observations || '',
        report.techSignature ? 'FIRMADO' : 'PENDIENTE',
        report.clientSignature ? 'FIRMADO' : 'PENDIENTE',
        (report.photos && report.photos.length) ? report.photos.length + ' foto(s)' : '0 fotos',
        pdfLink,
        Utilities.formatDate(new Date(), 'GMT-5', 'yyyy-MM-dd HH:mm:ss')
      ];

      // Buscar si ya existe la fila para actualizarla, o agregarla
      var idColIndex = 1; // Columna A = N° Reporte
      var existingRowIndex = findRowByValue(sheet, idColIndex, reportNumber);

      if (existingRowIndex > 1) {
        sheet.getRange(existingRowIndex, 1, 1, rowValues.length).setValues([rowValues]);
      } else {
        sheet.appendRow(rowValues);
      }

      return responseJson({
        status: 'success',
        message: 'Reporte ' + reportNumber + ' sincronizado exitosamente en Google Sheets.',
        row: existingRowIndex > 1 ? existingRowIndex : sheet.getLastRow(),
        pdfLink: pdfLink
      });
    }

    // 4. SINCRONIZAR PARQUE DE COMPRESORES (CATÁLOGO)
    if (action === 'sync_equipments') {
      var eqSheet = getOrCreateSheet(ss, 'Parque de Compresores', [
        'ID Interno',
        'API / ID Máquina',
        'Cliente',
        'Modelo',
        'Fabricante',
        'Horómetro (hrs)',
        'Presión Trabajo',
        'Caudal (cfm)',
        'Tipo Aceite',
        'Ubicación',
        'Estado',
        'Última Actualización'
      ]);

      var equipments = data.equipments || [];
      var lastRow = eqSheet.getLastRow();
      if (lastRow > 1) {
        eqSheet.getRange(2, 1, lastRow - 1, eqSheet.getLastColumn()).clearContent();
      }

      if (equipments.length > 0) {
        var eqRows = equipments.map(function(eq) {
          return [
            eq.id || '',
            eq.apiCode || eq.serialNumber || '',
            eq.client || '',
            eq.model || '',
            eq.manufacturer || 'Atlas Copco',
            eq.hourMeter || 0,
            eq.pressure || '',
            eq.airflow || '',
            eq.oilType || 'Ndurance (Presentación 5 L)',
            eq.location || '',
            eq.status || 'Activo',
            Utilities.formatDate(new Date(), 'GMT-5', 'yyyy-MM-dd HH:mm:ss')
          ];
        });
        eqSheet.getRange(2, 1, eqRows.length, eqRows[0].length).setValues(eqRows);
      }

      return responseJson({
        status: 'success',
        message: equipments.length + ' equipos sincronizados en Google Sheets.'
      });
    }

    // 5. SINCRONIZAR CLIENTES
    if (action === 'sync_clients') {
      var clientSheet = getOrCreateSheet(ss, 'Clientes', [
        'ID Cliente',
        'Nombre Empresa',
        'Dirección / Planta',
        'Contacto',
        'Notas',
        'Última Actualización'
      ]);

      var clients = data.clients || [];
      var lastClientRow = clientSheet.getLastRow();
      if (lastClientRow > 1) {
        clientSheet.getRange(2, 1, lastClientRow - 1, clientSheet.getLastColumn()).clearContent();
      }

      if (clients.length > 0) {
        var clientRows = clients.map(function(c) {
          return [
            c.id || '',
            c.name || '',
            c.address || '',
            c.contact || '',
            c.notes || '',
            Utilities.formatDate(new Date(), 'GMT-5', 'yyyy-MM-dd HH:mm:ss')
          ];
        });
        clientSheet.getRange(2, 1, clientRows.length, clientRows[0].length).setValues(clientRows);
      }

      return responseJson({
        status: 'success',
        message: clients.length + ' clientes sincronizados en Google Sheets.'
      });
    }

    return responseJson({ status: 'error', message: 'Acción no reconocida: ' + action });

  } catch (error) {
    return responseJson({ status: 'error', message: error.toString() });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  return ContentService.createTextOutput("INDUSTRAC Google Sheets & Drive Webhook ACTIVO y funcionando.");
}

// Helpers
function getOrCreateFolder(folderName) {
  var folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return DriveApp.createFolder(folderName);
}

function getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  // Si la pestaña está vacía (sin filas), crear automáticamente los encabezados con estilo profesional
  if (sheet.getLastRow() === 0 && headers && headers.length > 0) {
    sheet.appendRow(headers);
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#031240');
    headerRange.setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function findRowByValue(sheet, colIndex, value) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colIndex - 1]).trim() === String(value).trim()) {
      return i + 1;
    }
  }
  return -1;
}

function responseJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
