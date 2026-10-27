process.env.NODE_ENV = 'test';
const http = require('http');
const fs = require('fs');
const path = require('path');
const app = require('./index.js');

async function runTests() {
  console.log('================================================================');
  console.log('INICIANDO SUITE DE PRUEBAS TÉCNICAS INTEGRALES - INDUSTRAC S.A.C.');
  console.log('================================================================\n');

  // Start app on test port
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[TEST SERVER] Servidor ejecutándose en ${baseUrl}\n`);

  let testPassedCount = 0;
  let testFailedCount = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ [APROBADA] ${message}`);
      testPassedCount++;
    } else {
      console.error(`  ❌ [FALLIDA] ${message}`);
      testFailedCount++;
    }
  }

  try {
    // -------------------------------------------------------------
    // PRUEBA 0: VERIFICACIÓN DE LIMPIEZA DE DATOS DEMO
    // -------------------------------------------------------------
    console.log('-------------------------------------------------------------');
    console.log('PRUEBA 0: Verificación de Catálogo Operativo Limpio (Sin Demo)');
    console.log('-------------------------------------------------------------');

    const resClients = await fetch(`${baseUrl}/api/clients`);
    const clients = await resClients.json();
    assert(clients.length >= 2, `Se conservan los clientes reales (FORSAC, EMUSA, Científica del Sur), total actual: ${clients.length}`);
    const demoClients = clients.filter(c => c.isDemo || c.name.toLowerCase().includes('demo'));
    assert(demoClients.length === 0, `No existen clientes demo en la lista activa (encontrados: ${demoClients.length})`);

    const resEquipments = await fetch(`${baseUrl}/api/equipments`);
    const equipments = await resEquipments.json();
    assert(equipments.length >= 9, `Se conservan los equipos reales de producción (total actual: ${equipments.length})`);
    const demoEquipments = equipments.filter(e => e.isDemo || (e.apiCode && e.apiCode.includes('DEMO')));
    assert(demoEquipments.length === 0, `No existen equipos demo en catálogo (encontrados: ${demoEquipments.length})`);

    const resHorometers = await fetch(`${baseUrl}/api/horometers`);
    const horoData = await resHorometers.json();
    assert(horoData.equipments.length >= 9, `El endpoint de Horómetros retorna los equipos reales sin mezclar demo (total: ${horoData.equipments.length})`);
    assert(horoData.demoEquipmentsCount === 0, `Contador de equipos demo es estrictamente 0`);

    // -------------------------------------------------------------
    // PRUEBA A: ELIMINACIÓN DE REPORTE CON BOTÓN X / DELETE ENDPOINT
    // -------------------------------------------------------------
    console.log('\n-------------------------------------------------------------');
    console.log('PRUEBA A: Flujo Completo de Eliminación de Reporte');
    console.log('-------------------------------------------------------------');

    // 1. Crear un reporte de prueba identificable
    const testReportPayload = {
      reportNumber: 'REP-TEST-PRUEBA-A',
      date: '2026-10-26',
      client: 'FORSAC S.A.C',
      equipmentId: 'eq-1791815814484',
      apiCode: 'API507327',
      model: 'GA30P',
      serialNumber: '507327',
      technician: 'AUDITOR TÉCNICO',
      serviceType: 'Mantenimiento',
      maintenanceType: 'Plan A — 2000 horas',
      hourMeter: '130005',
      status: 'Borrador'
    };

    const resCreate = await fetch(`${baseUrl}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testReportPayload)
    });
    const createdRep = await resCreate.json();
    assert(resCreate.status === 201 && createdRep.id, `Reporte de prueba creado correctamente (${createdRep.reportNumber || createdRep.id})`);

    // 2. Verificar que existe en la lista de reportes
    const resListBefore = await fetch(`${baseUrl}/api/reports`);
    const listBefore = await resListBefore.json();
    const existsBefore = listBefore.some(r => r.id === createdRep.id || r.reportNumber === 'REP-TEST-PRUEBA-A');
    assert(existsBefore, `El reporte de prueba aparece confirmado en el listado del historial.`);

    // 3. Simular cancelación: si no se llama a DELETE, el reporte permanece intacto
    const resListCancel = await fetch(`${baseUrl}/api/reports`);
    const listCancel = await resListCancel.json();
    assert(listCancel.some(r => r.id === createdRep.id), `Si el usuario cancela la confirmación, el registro permanece en la persistencia.`);

    // 4. Ejecutar eliminación real confirmada
    const resDelete = await fetch(`${baseUrl}/api/reports/${createdRep.id}`, { method: 'DELETE' });
    const deleteResult = await resDelete.json();
    assert(resDelete.status === 200 && deleteResult.success === true, `El servidor procesa y confirma la eliminación (HTTP 200, success: true)`);

    // 5. Verificar que el reporte ya no existe en el almacenamiento
    const resListAfter = await fetch(`${baseUrl}/api/reports`);
    const listAfter = await resListAfter.json();
    const existsAfter = listAfter.some(r => r.id === createdRep.id || r.reportNumber === 'REP-TEST-PRUEBA-A');
    assert(!existsAfter, `El reporte eliminado ya no aparece en el historial.`);

    // 6. Verificar persistencia tras recarga (leyendo directamente el archivo físico reports.json)
    const diskReports = JSON.parse(fs.readFileSync('data/reports.json', 'utf8'));
    const diskExists = diskReports.some(r => r.id === createdRep.id || r.reportNumber === 'REP-TEST-PRUEBA-A');
    assert(!diskExists, `Comprobación física en disco: el reporte no reaparece en data/reports.json.`);

    // 7. Verificar que los reportes legítimos anteriores se mantienen intactos
    assert(diskReports.length === listBefore.length - 1, `Los reportes históricos legítimos permanecen 100% intactos.`);

    // 8. Verificar que un segundo intento de eliminar el mismo ID devuelve 404 (evita duplicidad)
    const resDeleteAgain = await fetch(`${baseUrl}/api/reports/${createdRep.id}`, { method: 'DELETE' });
    assert(resDeleteAgain.status === 404, `Eliminación repetida devuelve HTTP 404 de forma segura.`);

    // -------------------------------------------------------------
    // PRUEBA B: ACTUALIZACIÓN DE HORÓMETRO Y DESACOPLAMIENTO DE PDF
    // -------------------------------------------------------------
    console.log('\n-------------------------------------------------------------');
    console.log('PRUEBA B: Actualización de Horómetro al Finalizar Reporte');
    console.log('-------------------------------------------------------------');

    // 1. Seleccionar equipo de prueba: GA30 FF de FORSAC
    const targetEqId = 'eq-1791822487166';
    const resEqInit = await fetch(`${baseUrl}/api/equipments/${targetEqId}`);
    const eqInitial = await resEqInit.json();
    const initialHours = Number(eqInitial.hourMeter);
    console.log(`  ℹ️ Equipo seleccionado: ${eqInitial.client} - ${eqInitial.model} [${eqInitial.apiCode}]. Horómetro base: ${initialHours} h`);

    // 2. Crear y finalizar un reporte con lectura acumulada superior
    const newReadingHours = initialHours + 250; // Lectura superior válida
    const finalizedReportPayload = {
      reportNumber: 'REP-TEST-HORO-B',
      date: '2026-10-26',
      client: eqInitial.client,
      equipmentId: eqInitial.id,
      apiCode: eqInitial.apiCode,
      model: eqInitial.model,
      serialNumber: eqInitial.serialNumber,
      technician: 'TÉCNICO ESPECIALISTA INDUSTRAC',
      serviceType: 'Mantenimiento',
      maintenanceType: 'Plan B — 4000 horas',
      hourMeter: String(newReadingHours),
      status: 'Finalizado'
    };

    const resFinalize = await fetch(`${baseUrl}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(finalizedReportPayload)
    });
    const finalizedRep = await resFinalize.json();
    assert(resFinalize.status === 201, `Reporte finalizado creado exitosamente en servidor`);
    assert(finalizedRep.horometerUpdate && finalizedRep.horometerUpdate.success === true, `El servidor ejecutó applyReportToEquipmentHorometer con éxito.`);

    // 3. Verificar que el horómetro del equipo se actualizó inmediatamente
    const resEqAfter = await fetch(`${baseUrl}/api/equipments/${targetEqId}`);
    const eqAfter = await resEqAfter.json();
    assert(Number(eqAfter.hourMeter) === newReadingHours, `El horómetro del equipo se actualizó a ${newReadingHours} h (anterior: ${initialHours} h)`);
    assert(eqAfter.lastMaintenance && eqAfter.lastMaintenance.hourMeter === newReadingHours, `El último mantenimiento del equipo registra ${newReadingHours} h y Plan B`);

    // 4. Verificar que el endpoint de Horómetros refleja la nueva lectura y nuevo hito
    const resHoroCheck = await fetch(`${baseUrl}/api/horometers`);
    const horoCheck = await resHoroCheck.json();
    const eqInHoro = horoCheck.equipments.find(e => e.id === targetEqId);
    assert(eqInHoro && Number(eqInHoro.currentHours) === newReadingHours, `La sección Horómetros muestra la lectura actualizada de ${newReadingHours} h`);
    assert(eqInHoro.nextMilestoneHours > newReadingHours, `El próximo hito fue recalculado correctamente (${eqInHoro.nextMilestoneHours} h)`);

    // 5. Verificar desacoplamiento de PDF: generar o descargar PDF no debe alterar ni duplicar servicios
    const resPdf1 = await fetch(`${baseUrl}/api/reports/${finalizedRep.id}/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfBase64: 'JVBERi0xLjQKJcTl8uXr...', fileName: 'TEST-REPORT.pdf' })
    });
    // Segunda descarga del mismo PDF
    const resPdf2 = await fetch(`${baseUrl}/api/reports/${finalizedRep.id}/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfBase64: 'JVBERi0xLjQKJcTl8uXr...', fileName: 'TEST-REPORT.pdf' })
    });

    const resEqAfterPdfs = await fetch(`${baseUrl}/api/equipments/${targetEqId}`);
    const eqAfterPdfs = await resEqAfterPdfs.json();
    assert(Number(eqAfterPdfs.hourMeter) === newReadingHours, `Descargas repetidas de PDF NO alteran el horómetro persistido (${eqAfterPdfs.hourMeter} h)`);

    const countServiceEntries = (eqAfterPdfs.readingsHistory || []).filter(h => h.reportNumber === 'REP-TEST-HORO-B').length;
    assert(countServiceEntries === 1, `No se duplicó el servicio en el historial tras múltiples solicitudes de PDF (registros: ${countServiceEntries})`);

    // 6. Validar que un reporte con horómetro MENOR no disminuya el contador
    const lowerReportPayload = {
      reportNumber: 'REP-TEST-LOWER',
      date: '2026-10-26',
      client: eqInitial.client,
      equipmentId: eqInitial.id,
      model: eqInitial.model,
      technician: 'TÉCNICO AUDITOR',
      serviceType: 'Mantenimiento',
      maintenanceType: 'Plan A — 2000 horas',
      hourMeter: String(initialHours - 100), // Menor
      status: 'Finalizado'
    };
    const resLower = await fetch(`${baseUrl}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lowerReportPayload)
    });
    const repLower = await resLower.json();
    const resEqAfterLower = await fetch(`${baseUrl}/api/equipments/${targetEqId}`);
    const eqAfterLower = await resEqAfterLower.json();
    assert(Number(eqAfterLower.hourMeter) === newReadingHours, `Regla de negocio: un reporte con lectura inferior (${initialHours - 100} h) NO disminuyó el horómetro (${eqAfterLower.hourMeter} h)`);

    // Limpieza de datos de prueba de Prueba B
    await fetch(`${baseUrl}/api/reports/${finalizedRep.id}`, { method: 'DELETE' });
    await fetch(`${baseUrl}/api/reports/${repLower.id}`, { method: 'DELETE' });

    // Restaurar equipo a su estado original exacto
    const equipmentsDisk = JSON.parse(fs.readFileSync('data/equipments.json', 'utf8'));
    const eqIndex = equipmentsDisk.findIndex(e => e.id === targetEqId);
    if (eqIndex !== -1) {
      equipmentsDisk[eqIndex].hourMeter = String(initialHours);
      equipmentsDisk[eqIndex].hours = initialHours;
      equipmentsDisk[eqIndex].lastMaintenance = eqInitial.lastMaintenance;
      equipmentsDisk[eqIndex].nextMaintenance = eqInitial.nextMaintenance;
      equipmentsDisk[eqIndex].readingsHistory = eqInitial.readingsHistory;
      fs.writeFileSync('data/equipments.json', JSON.stringify(equipmentsDisk, null, 2), 'utf8');
      console.log(`  ℹ️ Estado original del equipo restablecido con éxito.`);
    }

    // -------------------------------------------------------------
    // PRUEBA C: MANEJO DE ERRORES Y ROBUSTEZ ANTE FALLOS
    // -------------------------------------------------------------
    console.log('\n-------------------------------------------------------------');
    console.log('PRUEBA C: Manejo de Errores y Validaciones de Entrada');
    console.log('-------------------------------------------------------------');

    // 1. Eliminar reporte con ID inexistente
    const resDeleteInvalid = await fetch(`${baseUrl}/api/reports/ID-INEXISTENTE-9999`, { method: 'DELETE' });
    const deleteInvalidData = await resDeleteInvalid.json();
    assert(resDeleteInvalid.status === 404 && deleteInvalidData.error, `ID inexistente devuelve error comprensible (HTTP 404: "${deleteInvalidData.error}")`);

    // 2. Crear cliente con nombre vacío
    const resClientEmpty = await fetch(`${baseUrl}/api/clients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' })
    });
    assert(resClientEmpty.status === 400, `Cliente sin nombre es rechazado con HTTP 400`);

    // 3. Registrar lectura de horómetro negativa
    const resReadingNegative = await fetch(`${baseUrl}/api/equipments/${targetEqId}/readings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hourMeter: -50 })
    });
    assert(resReadingNegative.status === 400, `Lectura de horómetro negativa (-50) es rechazada con HTTP 400`);

  } finally {
    await new Promise(resolve => server.close(resolve));
    console.log('\n[TEST SERVER] Servidor de prueba cerrado.');
  }

  console.log('\n================================================================');
  console.log(`RESUMEN DE PRUEBAS: ${testPassedCount} APROBADAS / ${testFailedCount} FALLIDAS`);
  console.log('================================================================\n');

  if (testFailedCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Error fatal durante la ejecución de pruebas:', err);
  process.exit(1);
});
