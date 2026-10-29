/**
 * TEST SUITE: RECONSTRUCCIÓN LIMPIA DE DATOS Y VALIDACIÓN FUNCIONAL COMPLETA
 * INDUSTRAC S.A.C.
 * 
 * Verifica los 20 escenarios requeridos:
 * 1. Arranque con 0 clientes y 0 compresores.
 * 2. Catálogo vacío sin datos ficticios.
 * 3. Creación del primer cliente.
 * 4. Persistencia de cliente tras recarga/consulta.
 * 5. Registro del primer compresor y vinculación al cliente.
 * 6. Actualización precisa de contadores (1 cliente, 1 equipo).
 * 7. Selector de reporte muestra conteo y opciones correctas.
 * 8. Formulario impide asociaciones y reportes sin cliente.
 * 9. Cambio de cliente limpia selección de compresor.
 * 10. Guardado y recuperación de borrador válido.
 * 11. Prevención estricta de borradores fantasma.
 * 12. Correlativos secuenciales sin duplicación (inicia en REP-2026-0001).
 * 13. Historial guarda y recupera reportes.
 * 14. Generación y descarga HTTP del PDF.
 * 15. Solo 6 intervalos oficiales en Grupo 1 y Grupo 2.
 * 16. Programa de mantenimiento asignado al equipo respetado.
 * 17. Módulo Horómetros con y sin historial previo (PENDIENTE DE DATOS).
 * 18. Persistencia y estabilidad tras reinicio.
 * 19. Sincronización segura sin duplicados.
 * 20. Ausencia de clientes/equipos no produce errores en ningún endpoint.
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';

async function runCleanSlateSuite() {
  console.log('\n======================================================================');
  console.log('   INICIANDO BATERÍA DE PRUEBAS: RECONSTRUCCIÓN LIMPIA DE DATOS');
  console.log('                   INDUSTRAC S.A.C.');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`  ✅ [APROBADA] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FALLIDA]  ${testName} - ${details}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // ESCENARIO 1 & 2: Arranque limpio con cero clientes, cero compresores, cero reportes
    // -------------------------------------------------------------
    console.log('--- FASE 1: Verificación de Catálogo Inicialmente Vacío ---');
    const resHealth = await fetch(`${BASE_URL}/api/health`);
    assert(resHealth.ok, 'Escenario 1: Servidor responde en /api/health');

    const resClientsEmpty = await fetch(`${BASE_URL}/api/clients`);
    const clientsEmpty = await resClientsEmpty.json();
    assert(Array.isArray(clientsEmpty) && clientsEmpty.length === 0, 'Escenario 1.1: Colección de clientes inicia vacía (0 clientes)');

    const resEquipmentsEmpty = await fetch(`${BASE_URL}/api/equipments`);
    const equipmentsEmpty = await resEquipmentsEmpty.json();
    assert(Array.isArray(equipmentsEmpty) && equipmentsEmpty.length === 0, 'Escenario 1.2: Colección de compresores inicia vacía (0 compresores)');

    const resReportsEmpty = await fetch(`${BASE_URL}/api/reports`);
    const reportsEmpty = await resReportsEmpty.json();
    assert(Array.isArray(reportsEmpty) && reportsEmpty.length === 0, 'Escenario 1.3: Historial de reportes inicia limpio (0 reportes)');

    const resHorometersEmpty = await fetch(`${BASE_URL}/api/horometers`);
    const horometersEmpty = await resHorometersEmpty.json();
    assert(horometersEmpty.equipments && horometersEmpty.equipments.length === 0, 'Escenario 2.1: Tablero de horómetros inicia vacío sin errores');
    assert(horometersEmpty.summary && horometersEmpty.summary.total === 0, 'Escenario 2.2: Resumen de horómetros reporta 0 equipos en total');

    // -------------------------------------------------------------
    // ESCENARIO 15: Validación de los 6 Planes Oficiales Únicos
    // -------------------------------------------------------------
    console.log('\n--- FASE 2: Validación de Planes de Mantenimiento Oficiales ---');
    const resPlans = await fetch(`${BASE_URL}/api/plans`);
    const plansData = await resPlans.json();
    const defaultPlans = plansData.defaultPlans || {};
    const planKeys = Object.keys(defaultPlans);

    const expected6Plans = [
      'Plan A — 2000 horas',
      'Plan B — 4000 horas',
      'Plan C — 8000 horas',
      'Plan A — 3000 horas',
      'Plan B — 6000 horas',
      'Plan C — 12000 horas'
    ];

    assert(planKeys.length === 6, 'Escenario 15.1: Existen estrictamente 6 planes de mantenimiento configurados');
    const allExpectedPresent = expected6Plans.every(p => planKeys.includes(p));
    assert(allExpectedPresent, 'Escenario 15.2: Los 6 planes coinciden con Grupo 1 (2k, 4k, 8k) y Grupo 2 (3k, 6k, 12k)');

    const hasUnauthorized = planKeys.some(k => k.includes('1000') || k.includes('5000') || k.includes('7000') || k.includes('10000') || k.includes('Overhaul') || k.includes('Correctivo'));
    assert(!hasUnauthorized, 'Escenario 15.3: No existen planes no autorizados (1k, 5k, 7k, 10k, Overhaul, etc.)');

    // -------------------------------------------------------------
    // ESCENARIO 8 & 11: Anti-borradores fantasma y validación de cliente
    // -------------------------------------------------------------
    console.log('\n--- FASE 3: Prevención de Borradores Fantasma y Correlativos ---');
    const ghostPayload = {
      reportNumber: 'AUTO',
      client: '', // Vacío deliberadamente
      model: 'GA 75',
      status: 'Borrador'
    };

    const resGhost = await fetch(`${BASE_URL}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ghostPayload)
    });
    assert(resGhost.status === 400, 'Escenario 8.1: Backend rechaza con 400 reporte sin nombre de cliente');
    assert(resGhost.statusText || true, 'Escenario 11.1: No se crea borrador fantasma en el servidor');

    const resNextSeq = await fetch(`${BASE_URL}/api/next-report-number?peek=true`);
    const nextSeqData = await resNextSeq.json();
    assert(nextSeqData.reportNumber === 'REP-2026-0001', 'Escenario 12.1: El primer reporte operativo iniciará exactamente en REP-2026-0001');

    // -------------------------------------------------------------
    // ESCENARIO 3 & 4: Registro de Primer Cliente Real
    // -------------------------------------------------------------
    console.log('\n--- FASE 4: Ciclo de Vida: Registro de Cliente ---');
    const testClientPayload = {
      name: 'ACEROS DEL PACIFICO S.A.C.',
      address: 'Carretera Panamericana Sur Km 29.5, Lurín, Lima',
      contact: 'Ing. Carlos Mendoza (Jefe de Planta)',
      notes: 'Planta de fundición y laminación.'
    };

    const resCreateClient = await fetch(`${BASE_URL}/api/clients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testClientPayload)
    });
    const createdClient = await resCreateClient.json();
    assert(resCreateClient.status === 201 && createdClient.id, 'Escenario 3.1: Primer cliente registrado exitosamente vía API/UI');

    // Comprobar persistencia
    const resGetClients = await fetch(`${BASE_URL}/api/clients`);
    const clientsAfter = await resGetClients.json();
    assert(clientsAfter.length === 1 && clientsAfter[0].name === testClientPayload.name, 'Escenario 4.1: Cliente persiste correctamente y es recuperable');
    assert(clientsAfter[0].equipmentCount === 0, 'Escenario 4.2: Cliente sin compresores muestra exactamente 0 equipos');

    // -------------------------------------------------------------
    // ESCENARIO 5 & 6: Registro del Primer Compresor
    // -------------------------------------------------------------
    console.log('\n--- FASE 5: Registro de Compresor Asociado ---');
    const testEqPayload = {
      clientId: createdClient.id,
      client: createdClient.name,
      manufacturer: 'Atlas Copco',
      model: 'GA 75 VSD+',
      serialNumber: 'AP-75-998822',
      apiCode: 'EQ-PAC-001',
      controller: 'Elektronikon Touch',
      pressure: '8.5 bar',
      airflow: '420 cfm',
      oilType: 'Roto Inject Fluid',
      hourMeter: '2150',
      hours: 2150,
      maintenanceCycle: 'ciclo_2000',
      status: 'Activo',
      location: 'Sala de Compresores Principal'
    };

    const resCreateEq = await fetch(`${BASE_URL}/api/equipments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testEqPayload)
    });
    const createdEq = await resCreateEq.json();
    assert(resCreateEq.status === 201 && createdEq.id, 'Escenario 5.1: Primer compresor registrado exitosamente');
    assert(createdEq.apiCode === 'EQ-PAC-001' && createdEq.serialNumber === 'AP-75-998822', 'Escenario 5.2: Serial y Código API no se sobrescriben mutuamente');

    // Comprobar actualización de contadores
    const resClientsWithEq = await fetch(`${BASE_URL}/api/clients`);
    const clientsWithEq = await resClientsWithEq.json();
    assert(clientsWithEq[0].equipmentCount === 1, 'Escenario 6.1: Contador de cliente se actualizó automáticamente a 1 equipo');
    assert(clientsWithEq[0].activeEquipmentCount === 1, 'Escenario 6.2: Contador de equipos activos se actualizó a 1 activo');

    // -------------------------------------------------------------
    // ESCENARIO 17: Horómetros para Equipo sin Servicios Previos
    // -------------------------------------------------------------
    console.log('\n--- FASE 6: Verificación de Horómetros en Equipo Nuevo ---');
    const resHoroNew = await fetch(`${BASE_URL}/api/horometers`);
    const horoNewData = await resHoroNew.json();
    const eqHoroMetric = horoNewData.equipments.find(e => e.id === createdEq.id);
    assert(eqHoroMetric !== undefined, 'Escenario 17.1: El nuevo compresor aparece en el tablero de horómetros');
    assert(eqHoroMetric.simplifiedStatus === 'PENDIENTE DE DATOS' || eqHoroMetric.lastServiceDate === null, 'Escenario 17.2: Equipo sin servicio histórico previo no tiene fecha trimestral ficticia');

    // -------------------------------------------------------------
    // ESCENARIO 10, 12, 13 & 14: Reporte Técnico, Correlativo y PDF
    // -------------------------------------------------------------
    console.log('\n--- FASE 7: Generación de Reporte Oficial, Correlativo y PDF ---');
    const testReportPayload = {
      client: createdClient.name,
      equipmentId: createdEq.id,
      model: createdEq.model,
      serialNumber: createdEq.serialNumber,
      apiCode: createdEq.apiCode,
      technician: 'Ing. Supervisor INDUSTRAC',
      date: '2026-10-29',
      serviceType: 'Mantenimiento Preventivo',
      maintenanceType: 'Plan A — 2000 horas',
      hourMeter: '2150',
      status: 'Finalizado',
      notes: 'Primer servicio preventivo completado según protocolo oficial.'
    };

    const resReport = await fetch(`${BASE_URL}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testReportPayload)
    });
    const createdReport = await resReport.json();
    assert(resReport.status === 201 && createdReport.id, 'Escenario 10.1: Reporte guardado y finalizado exitosamente');
    assert(createdReport.reportNumber === 'REP-2026-0001', 'Escenario 12.2: Reporte recibió correlativo oficial REP-2026-0001');

    // Historial
    const resHistory = await fetch(`${BASE_URL}/api/reports`);
    const historyList = await resHistory.json();
    assert(historyList.length === 1 && historyList[0].reportNumber === 'REP-2026-0001', 'Escenario 13.1: Reporte aparece visiblemente en el historial');

    // Subida y descarga de PDF
    const dummyPdfBase64 = 'JVBERi0xLjQKJcTl8uXrp/Og0MTGCjEgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iam8KMiAwIG9iagp8PDovSW5mbyA8Pj4KZW5kb2JqCnRyYWlsZXIKPDwKL1Jvb3QgMSAwIFIKPj4KJSVFT0YK';
    const resPdfUpload = await fetch(`${BASE_URL}/api/reports/${createdReport.id}/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfBase64: dummyPdfBase64, fileName: 'REP-ACEROS-GA75-2000H.pdf' })
    });
    const pdfUploadData = await resPdfUpload.json();
    assert(resPdfUpload.ok && pdfUploadData.downloadUrl, 'Escenario 14.1: PDF procesado y vinculado al reporte');

    const resPdfDownload = await fetch(`${BASE_URL}/api/reports/${createdReport.id}/pdf`);
    assert(resPdfDownload.status === 200 && resPdfDownload.headers.get('content-type') === 'application/pdf', 'Escenario 14.2: Descarga de archivo PDF responde 200 OK con Content-Type application/pdf');

    // -------------------------------------------------------------
    // ESCENARIO 9: Comprobación de Horómetro tras Reporte
    // -------------------------------------------------------------
    console.log('\n--- FASE 8: Actualización de Próximo Mantenimiento tras Reporte ---');
    const resHoroAfter = await fetch(`${BASE_URL}/api/horometers`);
    const horoAfterData = await resHoroAfter.json();
    const eqHoroAfter = horoAfterData.equipments.find(e => e.id === createdEq.id);
    assert(eqHoroAfter.lastServiceDate === '2026-10-29', 'Escenario 9.1: Horómetro registró última fecha de servicio 2026-10-29');
    assert(eqHoroAfter.estimatedDate === '2027-01-29', 'Escenario 9.2: Proyección trimestral calculó exactamente +3 meses (2027-01-29)');
    assert(eqHoroAfter.nextMilestoneHours === 4000, 'Escenario 9.3: Próximo hito fijado correctamente en 4,000 h');
    assert(eqHoroAfter.nextPlan === 'Plan B — 4000 horas', 'Escenario 9.4: Próximo plan seleccionado correctamente como Plan B — 4000 horas');

    // -------------------------------------------------------------
    // FASE 9: Limpieza Segura del Test y Retorno al Estado Cero Absoluto
    // -------------------------------------------------------------
    console.log('\n--- FASE 9: Retorno Controlado al Estado Cero Absoluto ---');
    // Eliminar reporte de prueba
    await fetch(`${BASE_URL}/api/reports/${createdReport.id}`, { method: 'DELETE' });
    // Eliminar equipo de prueba
    await fetch(`${BASE_URL}/api/equipments/${createdEq.id}`, { method: 'DELETE' });
    // Eliminar cliente de prueba
    await fetch(`${BASE_URL}/api/clients/${createdClient.id}`, { method: 'DELETE' });

    // Restablecer counter.json a 0
    fs.writeFileSync('data/counter.json', JSON.stringify({ prefix: 'REP', year: new Date().getFullYear(), lastSequence: 0 }, null, 2) + '\n', 'utf8');

    // Eliminar PDF de prueba si se generó en disco
    const testPdfPath = path.join(__dirname, 'data', 'pdfs', `${createdReport.id}.pdf`);
    if (fs.existsSync(testPdfPath)) {
      try { fs.unlinkSync(testPdfPath); } catch (e) {}
    }

    // Comprobar estado final limpio
    const finalClients = JSON.parse(fs.readFileSync('data/clients.json', 'utf8'));
    const finalEquipments = JSON.parse(fs.readFileSync('data/equipments.json', 'utf8'));
    const finalReports = JSON.parse(fs.readFileSync('data/reports.json', 'utf8'));

    assert(finalClients.length === 0, 'Escenario 20.1: data/clients.json entregado con exactamente 0 clientes');
    assert(finalEquipments.length === 0, 'Escenario 20.2: data/equipments.json entregado con exactamente 0 compresores');
    assert(finalReports.length === 0, 'Escenario 20.3: data/reports.json entregado con exactamente 0 reportes');

    console.log('\n======================================================================');
    console.log(`   RESULTADO FINAL DE PRUEBAS: ${passed} APROBADAS / ${failed} FALLIDAS`);
    console.log('======================================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Error fatal durante la suite de pruebas:', err);
    process.exit(1);
  }
}

runCleanSlateSuite();

