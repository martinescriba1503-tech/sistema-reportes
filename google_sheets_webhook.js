/**
 * ============================================================================
 * SCRIPT PARA GOOGLE SHEETS & GOOGLE DRIVE — INDUSTRAC S.A.C.
 * Sistema Inteligente de Reportes Técnicos & Base de Datos Cloud en Sheets
 * Carpeta en Google Drive: PDF_REPORTES2027
 * ============================================================================
 * 
 * INSTRUCCIONES DE ACTUALIZACIÓN / INSTALACIÓN PASO A PASO (EN 2 MINUTOS):
 * 1. Abre tu hoja de Google Sheets ("REPORTES INDUSTRAC 2027").
 * 2. En el menú superior, haz clic en: Extensiones > Apps Script.
 * 3. Selecciona todo el código existente (Ctrl+A), bórralo y pega TODO este archivo completo.
 * 4. Haz clic en el icono "Guardar" (icono de disquete).
 * 5. Haz clic en el botón azul superior "Implementar" > "Administrar implementaciones".
 * 6. Haz clic en el icono del lápiz (Editar) junto a tu implementación activa.
 * 7. En el selector "Versión", elige "Nueva versión" (New version).
 * 8. Asegúrate de que:
 *    - Ejecutar como: "Yo" (tu cuenta de Google)
 *    - Quién tiene acceso: "Cualquier usuario" (Anyone)
 * 9. Haz clic en "Implementar".
 * 
 * ¡Listo! Tu Google Sheets ahora funciona como Base de Datos Cloud bidireccional
 * para Clientes, Catálogo de Compresores y Reportes Técnicos de INDUSTRAC.
 */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Obtener lista de clientes como JSON
  if (action === 'get_clients') {
    return responseJson({
      status: 'success',
      clients: parseClientsFromSheet(ss)
    });
  }

  // 2. Obtener catálogo de compresores como JSON
  if (action === 'get_equipments') {
    return responseJson({
      status: 'success',
      equipments: parseEquipmentsFromSheet(ss)
    });
  }

  // 3. Obtener toda la base de datos cloud (Clientes + Equipos) en una sola consulta rápida
  if (action === 'get_all_data') {
    return responseJson({
      status: 'success',
      clients: parseClientsFromSheet(ss),
      equipments: parseEquipmentsFromSheet(ss),
      sheetName: ss.getName(),
      timestamp: new Date().toISOString()
    });
  }

  // 4. Test de conexión GET
  if (action === 'test_connection') {
    return responseJson({
      status: 'success',
      message: '¡Conexión bidireccional activa con Google Sheets DB!',
      sheetName: ss.getName()
    });
  }

  return ContentService.createTextOutput("INDUSTRAC Google Sheets & Drive Webhook ACTIVO y funcionando como Base de Datos Cloud.");
}

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

    // 2. LECTURAS BIDIRECCIONALES DESDE POST
    if (action === 'get_clients') {
      return responseJson({ status: 'success', clients: parseClientsFromSheet(ss) });
    }
    if (action === 'get_equipments') {
      return responseJson({ status: 'success', equipments: parseEquipmentsFromSheet(ss) });
    }
    if (action === 'get_all_data') {
      return responseJson({
        status: 'success',
        clients: parseClientsFromSheet(ss),
        equipments: parseEquipmentsFromSheet(ss),
        sheetName: ss.getName()
      });
    }

    // 3. SUBIR ARCHIVO PDF DIRECTAMENTE A GOOGLE DRIVE (Carpeta: PDF_REPORTES2027)
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
              // Columna 31 = 'Enlace PDF (Google Drive)'
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

    // 4. SINCRONIZAR O CREAR REPORTE TÉCNICO A GOOGLE SHEETS
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
      var reportNumber = report.reportNumber || 'REP-SIN-NUM';

      var rowValues = [
        reportNumber,
        report.date || '',
        report.status || 'Finalizado',
        report.client || '',
        report.address || '',
        report.model || '',
        report.apiCode || report.serialNumber || '',
        report.manufacturer || 'Atlas Copco',
        report.technician || '',
        report.serviceType || 'Mantenimiento',
        report.maintenanceType || '',
        report.hourMeter || '0',
        report.oilType || '',
        report.oilLevel || '',
        report.regulations ? (report.regulations.loadPressure || '') : '',
        report.regulations ? (report.regulations.unloadPressure || '') : '',
        report.technicalParameters ? (report.technicalParameters.elem1Temp || '') : '',
        report.technicalParameters ? (report.technicalParameters.oilTemp || '') : '',
        report.electrical ? (report.electrical.u1_u2 || '') : '',
        report.electrical ? (report.electrical.u2_u3 || '') : '',
        report.electrical ? (report.electrical.u1_u3 || '') : '',
        report.electrical ? (report.electrical.i_l1 || '') : '',
        report.electrical ? (report.electrical.i_l2 || '') : '',
        report.electrical ? (report.electrical.i_l3 || '') : '',
        report.electrical ? (report.electrical.f1 || '') : '',
        formatPartsSummary(report.parts),
        report.observations || '',
        report.techSignature ? 'FIRMADO' : 'PENDIENTE',
        report.clientSignature ? 'FIRMADO' : 'PENDIENTE',
        (report.photos ? report.photos.length : 0) + ' fotos',
        report.pdfDriveDownloadUrl || report.pdfDriveUrl || '',
        Utilities.formatDate(new Date(), 'GMT-5', 'yyyy-MM-dd HH:mm:ss')
      ];

      // Si el reporte ya existe (por N° de reporte), actualizar la fila; si no, agregar una nueva fila
      var existingRow = findRowByValue(sheet, 1, reportNumber);
      if (existingRow > 1) {
        sheet.getRange(existingRow, 1, 1, rowValues.length).setValues([rowValues]);
      } else {
        sheet.appendRow(rowValues);
      }

      // INTERCONEXIÓN AUTOMÁTICA CON LA HOJA 'Parque de Compresores':
      // Actualizar automáticamente el Horómetro del equipo en la pestaña de Compresores
      try {
        var compSheet = ss.getSheetByName('Parque de Compresores');
        if (compSheet && compSheet.getLastRow() > 1 && report.hourMeter) {
          var repApi = String(report.apiCode || report.serialNumber || '').trim().toLowerCase();
          var repModel = String(report.model || '').trim().toLowerCase();
          var repClient = String(report.client || '').trim().toLowerCase();
          var newHours = Number(report.hourMeter) || 0;
          var compData = compSheet.getDataRange().getValues();

          for (var cr = 1; cr < compData.length; cr++) {
            var cId = String(compData[cr][0] || '').trim().toLowerCase();
            var cApi = String(compData[cr][1] || '').trim().toLowerCase();
            var cClient = String(compData[cr][2] || '').trim().toLowerCase();
            var cModel = String(compData[cr][3] || '').trim().toLowerCase();

            var matched = false;
            if (report.equipmentId && cId === String(report.equipmentId).toLowerCase()) matched = true;
            else if (repApi && cApi && (repApi === cApi || cApi.indexOf(repApi) !== -1 || repApi.indexOf(cApi) !== -1)) matched = true;
            else if (repModel && cModel && (repModel === cModel || repModel.indexOf(cModel) !== -1 || cModel.indexOf(repModel) !== -1) && repClient && cClient.indexOf(repClient) !== -1) matched = true;

            if (matched) {
              var oldHoursInSheet = Number(compData[cr][5]) || 0;
              if (newHours >= oldHoursInSheet || oldHoursInSheet === 0) {
                // Columna 6 = 'Horómetro (hrs)'
                compSheet.getRange(cr + 1, 6).setValue(newHours);
                // Columna 12 = 'Última Actualización'
                compSheet.getRange(cr + 1, 12).setValue(Utilities.formatDate(new Date(), 'GMT-5', 'yyyy-MM-dd HH:mm:ss'));
              }
              break;
            }
          }
        }
      } catch (eHoroComp) {
        // No interrumpir respuesta de guardado si ocurre algún detalle en Google Sheets
      }

      return responseJson({
        status: 'success',
        message: 'Reporte ' + reportNumber + ' registrado y horómetro de compresor actualizado en Google Sheets.',
        row: existingRow > 1 ? existingRow : sheet.getLastRow()
      });
    }

    // 5. ELIMINAR REPORTE DE GOOGLE SHEETS
    if (action === 'delete_report') {
      var repSheet = ss.getSheetByName('Reportes Técnicos');
      if (repSheet) {
        var repNum = data.reportNumber || data.reportId;
        if (repNum) {
          var row = findRowByValue(repSheet, 1, repNum);
          if (row > 1) {
            repSheet.deleteRow(row);
            return responseJson({ status: 'success', message: 'Reporte ' + repNum + ' eliminado de Google Sheets.' });
          }
        }
      }
      return responseJson({ status: 'success', message: 'Reporte no encontrado o ya eliminado.' });
    }

    // 6. GUARDAR / EDITAR CLIENTE INDIVIDUAL
    if (action === 'save_client') {
      var clientSheet = getOrCreateSheet(ss, 'Clientes', [
        'ID Cliente',
        'Nombre Empresa',
        'Dirección / Planta',
        'Contacto',
        'Notas',
        'Última Actualización'
      ]);

      var client = data.client || {};
      if (!client.name) {
        return responseJson({ status: 'error', message: 'Nombre de cliente requerido.' });
      }

      var clientId = client.id || ('cli-' + new Date().getTime());
      var clientRow = [
        clientId,
        client.name || '',
        client.address || '',
        client.contact || '',
        client.notes || '',
        Utilities.formatDate(new Date(), 'GMT-5', 'yyyy-MM-dd HH:mm:ss')
      ];

      var existingClientRow = findRowByValue(clientSheet, 1, clientId);
      if (existingClientRow === -1 && client.name) {
        existingClientRow = findRowByValue(clientSheet, 2, client.name);
      }

      if (existingClientRow > 1) {
        clientSheet.getRange(existingClientRow, 1, 1, clientRow.length).setValues([clientRow]);
      } else {
        clientSheet.appendRow(clientRow);
      }

      return responseJson({
        status: 'success',
        message: 'Cliente "' + client.name + '" guardado exitosamente en Google Sheets.',
        client: client
      });
    }

    // 7. ELIMINAR CLIENTE DE GOOGLE SHEETS
    if (action === 'delete_client') {
      var clientSheet = ss.getSheetByName('Clientes');
      if (clientSheet && (data.clientId || data.clientName)) {
        var targetId = data.clientId ? String(data.clientId).trim().toLowerCase() : '';
        var targetName = data.clientName ? String(data.clientName).trim().toLowerCase() : '';
        var cData = clientSheet.getDataRange().getValues();
        var cDeleted = 0;
        for (var cr = cData.length - 1; cr >= 1; cr--) {
          var cId = String(cData[cr][0] || '').trim().toLowerCase();
          var cName = String(cData[cr][1] || '').trim().toLowerCase();
          if ((targetId && cId === targetId) || (targetName && cName === targetName)) {
            clientSheet.deleteRow(cr + 1);
            cDeleted++;
          }
        }
        if (cDeleted > 0) {
          return responseJson({ status: 'success', message: 'Cliente eliminado de Google Sheets (' + cDeleted + ' fila/s).' });
        }
      }
      return responseJson({ status: 'success', message: 'Cliente no encontrado o ya eliminado.' });
    }

    // 8. SINCRONIZAR LISTA COMPLETA DE CLIENTES (FUSIÓN INTELIGENTE NO DESTRUCTIVA)
    if (action === 'sync_clients') {
      var clientSheet = getOrCreateSheet(ss, 'Clientes', [
        'ID Cliente',
        'Nombre Empresa',
        'Dirección / Planta',
        'Contacto',
        'Notas',
        'Última Actualización'
      ]);

      var incomingClients = data.clients || [];
      if (!Array.isArray(incomingClients) || incomingClients.length === 0) {
        return responseJson({ status: 'success', message: 'Sin clientes para sincronizar.' });
      }

      var existingClients = parseClientsFromSheet(ss);
      var clientMap = {};
      existingClients.forEach(function(ec) {
        if (ec.id) clientMap[ec.id] = ec;
        if (ec.name) clientMap[ec.name.toLowerCase().trim()] = ec;
      });

      incomingClients.forEach(function(c) {
        if (!c || !c.name) return;
        var existing = clientMap[c.id] || clientMap[c.name.toLowerCase().trim()];
        var merged = existing ? Object.assign(existing, c) : c;
        if (c.id) clientMap[c.id] = merged;
        if (c.name) clientMap[c.name.toLowerCase().trim()] = merged;
      });

      var uniqueClients = [];
      var seenIds = {};
      Object.keys(clientMap).forEach(function(k) {
        var c = clientMap[k];
        var uKey = c.id || c.name;
        if (uKey && !seenIds[uKey]) {
          seenIds[uKey] = true;
          uniqueClients.push(c);
        }
      });

      var lastClientRow = clientSheet.getLastRow();
      if (lastClientRow > 1) {
        clientSheet.getRange(2, 1, lastClientRow - 1, clientSheet.getLastColumn()).clearContent();
      }

      if (uniqueClients.length > 0) {
        var clientRows = uniqueClients.map(function(c) {
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
        message: uniqueClients.length + ' clientes sincronizados y protegidos en Google Sheets.'
      });
    }

    // 9. GUARDAR / EDITAR COMPRESOR INDIVIDUAL
    if (action === 'save_equipment') {
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

      var eq = data.equipment || {};
      var eqId = eq.id || ('eq-' + new Date().getTime());
      var eqRow = [
        eqId,
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

      var existingEqRow = findRowByValue(eqSheet, 1, eqId);
      if (existingEqRow === -1 && eq.apiCode) {
        existingEqRow = findRowByValue(eqSheet, 2, eq.apiCode);
      }

      if (existingEqRow > 1) {
        eqSheet.getRange(existingEqRow, 1, 1, eqRow.length).setValues([eqRow]);
      } else {
        eqSheet.appendRow(eqRow);
      }

      return responseJson({
        status: 'success',
        message: 'Compresor "' + (eq.model || eq.apiCode) + '" guardado exitosamente en Google Sheets.',
        equipment: eq
      });
    }

    // 10. ELIMINAR COMPRESOR DE GOOGLE SHEETS
    if (action === 'delete_equipment') {
      var eqSheet = ss.getSheetByName('Parque de Compresores');
      if (eqSheet && (data.equipmentId || data.apiCode || data.model)) {
        var targetId = data.equipmentId ? String(data.equipmentId).trim().toLowerCase() : '';
        var targetApi = data.apiCode ? String(data.apiCode).trim().toLowerCase() : '';
        var targetModel = data.model ? String(data.model).trim().toLowerCase() : '';
        
        var eqSheetData = eqSheet.getDataRange().getValues();
        var eqDeleted = 0;
        for (var er = eqSheetData.length - 1; er >= 1; er--) {
          var rowId = String(eqSheetData[er][0] || '').trim().toLowerCase();
          var rowApi = String(eqSheetData[er][1] || '').trim().toLowerCase();
          var rowModel = String(eqSheetData[er][3] || '').trim().toLowerCase();

          var match = false;
          if (targetId && rowId && rowId === targetId) match = true;
          if (targetApi && rowApi && rowApi === targetApi) match = true;
          if (!match && targetId && rowApi && targetId === rowApi) match = true;
          if (!match && targetApi && rowId && targetApi === rowId) match = true;

          if (match) {
            eqSheet.deleteRow(er + 1);
            eqDeleted++;
          }
        }
        if (eqDeleted > 0) {
          return responseJson({ status: 'success', message: 'Compresor eliminado de Google Sheets (' + eqDeleted + ' fila/s).' });
        }
      }
      return responseJson({ status: 'success', message: 'Compresor no encontrado o ya eliminado.' });
    }

    // 11. SINCRONIZAR PARQUE DE COMPRESORES COMPLETO (FUSIÓN INTELIGENTE NO DESTRUCTIVA)
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

      var incomingEquipments = data.equipments || [];
      if (!Array.isArray(incomingEquipments) || incomingEquipments.length === 0) {
        return responseJson({ status: 'success', message: 'Sin equipos para sincronizar.' });
      }

      var existingEquipments = parseEquipmentsFromSheet(ss);
      var eqMap = {};
      existingEquipments.forEach(function(ee) {
        var key = ee.id || ee.apiCode;
        if (key) eqMap[key] = ee;
      });

      incomingEquipments.forEach(function(eq) {
        if (!eq) return;
        var key = eq.id || eq.apiCode;
        if (key) {
          var existing = eqMap[key];
          eqMap[key] = existing ? Object.assign(existing, eq) : eq;
        }
      });

      var uniqueEquipments = [];
      var seenEqKeys = {};
      Object.keys(eqMap).forEach(function(k) {
        var eq = eqMap[k];
        var uKey = eq.id || eq.apiCode;
        if (uKey && !seenEqKeys[uKey]) {
          seenEqKeys[uKey] = true;
          uniqueEquipments.push(eq);
        }
      });

      var lastRow = eqSheet.getLastRow();
      if (lastRow > 1) {
        eqSheet.getRange(2, 1, lastRow - 1, eqSheet.getLastColumn()).clearContent();
      }

      if (uniqueEquipments.length > 0) {
        var eqRows = uniqueEquipments.map(function(eq) {
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
        message: uniqueEquipments.length + ' equipos sincronizados y protegidos en Google Sheets.'
      });
    }

    return responseJson({ status: 'error', message: 'Acción no reconocida: ' + action });

  } catch (error) {
    return responseJson({ status: 'error', message: error.toString() });
  } finally {
    lock.releaseLock();
  }
}

// Helpers para parseo de datos de hojas
function parseClientsFromSheet(ss) {
  var clientSheet = ss.getSheetByName('Clientes');
  if (!clientSheet || clientSheet.getLastRow() < 2) return [];

  var data = clientSheet.getDataRange().getValues();
  var clients = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var id = String(row[0] || '').trim();
    var name = String(row[1] || '').trim();
    if (id || name) {
      clients.push({
        id: id || ('cli-' + new Date().getTime() + '-' + i),
        name: name,
        address: String(row[2] || '').trim(),
        contact: String(row[3] || '').trim(),
        notes: String(row[4] || '').trim(),
        updatedAt: String(row[5] || '')
      });
    }
  }
  return clients;
}

function parseEquipmentsFromSheet(ss) {
  var eqSheet = ss.getSheetByName('Parque de Compresores');
  if (!eqSheet || eqSheet.getLastRow() < 2) return [];

  var data = eqSheet.getDataRange().getValues();
  var equipments = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var id = String(row[0] || '').trim();
    var apiCode = String(row[1] || '').trim();
    var client = String(row[2] || '').trim();
    var model = String(row[3] || '').trim();

    if (id || apiCode || model) {
      equipments.push({
        id: id || ('eq-' + new Date().getTime() + '-' + i),
        apiCode: apiCode,
        client: client,
        model: model,
        manufacturer: String(row[4] || 'Atlas Copco').trim(),
        hourMeter: String(row[5] || '0').trim(),
        hours: Number(row[5]) || 0,
        pressure: String(row[6] || '').trim(),
        airflow: String(row[7] || '').trim(),
        oilType: String(row[8] || 'Ndurance (Presentación 5 L)').trim(),
        location: String(row[9] || 'Sala de Compresores').trim(),
        status: String(row[10] || 'Activo').trim(),
        active: String(row[10] || 'Activo').trim().toLowerCase() !== 'inactivo',
        updatedAt: String(row[11] || '')
      });
    }
  }
  return equipments;
}

// Helpers generales
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
  var target = String(value || '').trim().toLowerCase();
  if (!target) return -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colIndex - 1] || '').trim().toLowerCase() === target) {
      return i + 1;
    }
  }
  return -1;
}

function formatPartsSummary(parts) {
  if (!parts || !Array.isArray(parts) || parts.length === 0) return 'Sin repuestos';
  return parts.map(function(p) {
    return (p.code || '') + ' - ' + (p.description || '') + ' (Cant: ' + (p.quantity || 1) + ')';
  }).join('; ');
}

function responseJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
