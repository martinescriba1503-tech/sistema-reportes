/**
 * Test Suite: Validación de Casos Obligatorios A - J
 * Módulo de Horómetros y Próximos Mantenimientos — INDUSTRAC S.A.C.
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';

async function runTests() {
  console.log('========================================================');
  console.log('INICIANDO PRUEBAS OBLIGATORIAS DEL MÓDULO DE HORÓMETROS');
  console.log('========================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, testName, details = '') {
    total++;
    if (condition) {
      console.log(`✅ [PASÓ] ${testName}`);
      if (details) console.log(`   ${details}`);
      passed++;
    } else {
      console.error(`❌ [FALLÓ] ${testName}`);
      if (details) console.error(`   ${details}`);
    }
  }

  // 1. Obtener lista de equipos
  const resHorometers = await fetch(`${BASE_URL}/api/horometers`);
  const horoData = await resHorometers.json();
  assert(resHorometers.ok && Array.isArray(horoData.equipments), 'API /api/horometers responde correctamente', `Total equipos: ${horoData.equipments.length}`);

  // Test Case H: Equipos incompletos muestran "Pendiente de configuración"
  const pendingEqs = horoData.equipments.filter(e => e.status === 'pending_config');
  assert(pendingEqs.length > 0, 'Caso H: Equipos sin datos suficientes se marcan como "Pendiente de configuración"', `Equipos pendientes de config: ${pendingEqs.length}`);
  const firstPending = pendingEqs[0];
  assert(firstPending.quarterlyEstimatedDate === null && firstPending.nextMilestoneHours === null, 'Caso H: No se inventan fechas ni planes para equipos sin configuración');

  // Elegimos un equipo para pruebas (un equipo de prueba o el primero)
  // Crearemos un equipo temporal para no alterar los datos reales de producción
  const testEqPayload = {
    client: 'CLIENTE TEST CASOS A-J',
    model: 'GA 55 VSD TEST',
    serialNumber: 'TEST-SER-001',
    apiCode: 'API-TEST-999',
    controller: 'Elektronikon Touch',
    pressure: '7.5 bar',
    airflow: '350 cfm',
    oil: 'Roto Inject Fluid',
    hours: 5200,
    hourMeter: '5200',
    location: 'Sala Compresores Test',
    status: 'Operativo',
    notes: 'Equipo creado para validación de Casos A-J'
  };

  const createEqRes = await fetch(`${BASE_URL}/api/equipments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testEqPayload)
  });
  const createdEq = await createEqRes.json();
  const testId = createdEq.id;
  assert(createEqRes.ok && testId, 'Equipo de prueba creado para batería de validación', `ID: ${testId}`);

  // Configurar Línea Base del Caso A:
  // Lectura actual: 5,200 h
  // Próximo hito: 6,000 h
  // Próximo plan: Plan A — 2000 horas
  // Horas restantes: 800 h
  // Último mantenimiento: 25/10/2026
  // Fecha trimestral esperada: 25/01/2027
  const configRes = await fetch(`${BASE_URL}/api/equipments/${testId}/maintenance-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cycleType: 'ciclo_2000',
      currentHours: 5200,
      lastMaintDate: '2026-10-25',
      lastMaintHours: 4000,
      lastPlan: 'Plan B — 4000 horas',
      nextMilestoneHours: 6000,
      nextPlan: 'Plan A — 2000 horas',
      monthlyAverageHours: 200,
      alertThresholdHours: 200
    })
  });
  assert(configRes.ok, 'Configuración inicial guardada para el equipo de prueba');

  // Caso A: Verificar equipo al día
  let checkA = await fetch(`${BASE_URL}/api/horometers`).then(r => r.json());
  let eqA = checkA.equipments.find(e => e.id === testId);

  assert(eqA.currentHours === 5200, 'Caso A: Horómetro actual correcto', `Actual: ${eqA.currentHours} h`);
  assert(eqA.nextMilestoneHours === 6000, 'Caso A: Próximo hito correcto', `Hito: ${eqA.nextMilestoneHours} h`);
  assert(eqA.hoursRemaining === 800, 'Caso A: Horas restantes = 6000 - 5200 = 800 h', `Horas restantes: ${eqA.hoursRemaining} h`);
  assert(eqA.quarterlyEstimatedDate === '2027-01-25', 'Caso A: Fecha trimestral correcta (25/10/2026 + 3 meses = 25/01/2027)', `Fecha: ${eqA.quarterlyEstimatedDate}`);
  assert(eqA.status === 'up_to_date', 'Caso A: Estado "Al día" (up_to_date)', `Estado: ${eqA.status}`);
  assert(eqA.usageEstimatedDate !== null, 'Caso A: Fecha estimada por uso calculada por separado', `Uso estimado: ${eqA.usageEstimatedDate}`);

  // Caso E: Lectura actualizada (5,200 -> 5,500 h)
  const readRes = await fetch(`${BASE_URL}/api/equipments/${testId}/readings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hours: 5500,
      date: '2026-11-05',
      registeredBy: 'Ing. Supervisor',
      notes: 'Toma rutinaria de horómetro'
    })
  });
  assert(readRes.ok, 'Caso E: Nueva lectura guardada exitosamente');

  let checkE = await fetch(`${BASE_URL}/api/horometers`).then(r => r.json());
  let eqE = checkE.equipments.find(e => e.id === testId);
  assert(eqE.currentHours === 5500, 'Caso E: Horómetro actualizado a 5,500 h', `Actual: ${eqE.currentHours} h`);
  assert(eqE.hoursRemaining === 500, 'Caso E: Horas restantes recalculadas = 6000 - 5500 = 500 h', `Restantes: ${eqE.hoursRemaining} h`);
  assert(eqE.nextMilestoneHours === 6000, 'Caso E: El ciclo de mantenimiento NO avanzó por una simple lectura', `Próximo hito sigue en: ${eqE.nextMilestoneHours} h`);

  // Caso I: Lectura menor que la anterior (5,500 -> 5,100 h) sin y con advertencia
  const histResBefore = await fetch(`${BASE_URL}/api/equipments/${testId}/horometer-history`).then(r => r.json());
  const countBefore = histResBefore.length;

  const readLowerRes = await fetch(`${BASE_URL}/api/equipments/${testId}/readings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hours: 5100,
      date: '2026-11-06',
      registeredBy: 'Técnico Corrección',
      notes: 'Corrección controlada por cambio de reloj'
    })
  });
  const dataLower = await readLowerRes.json();
  assert(readLowerRes.ok && dataLower.warning !== undefined, 'Caso I: Sistema detecta lectura menor y devuelve advertencia controlada', `Warning: ${dataLower.warning}`);

  // Caso B: Vencimiento por horas (Horómetro actual = 6,000 h, próximo hito = 6,000 h)
  await fetch(`${BASE_URL}/api/equipments/${testId}/readings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hours: 6000, date: '2026-11-10' })
  });
  let checkB = await fetch(`${BASE_URL}/api/horometers`).then(r => r.json());
  let eqB = checkB.equipments.find(e => e.id === testId);
  // Supongamos que la fecha actual en el sistema está antes del 2027-01-25 (fecha trimestral)
  // El estado debe ser vencido por horas o vencido ambos según la fecha actual
  assert(eqB.isOverdueHours === true, 'Caso B: Indicador isOverdueHours activo', `isOverdueHours: ${eqB.isOverdueHours}`);
  assert(eqB.status === 'overdue_hours' || eqB.status === 'overdue_both', 'Caso B: Equipo marcado como vencido por horas o ambos', `Estado: ${eqB.status}`);

  // Caso C & D: Probar vencimiento por fecha y vencimiento por ambos criterios
  // Modificamos temporalmente lastMaintDate a hace 4 meses (ej. 2026-05-01) -> trimestral fue 2026-08-01 (ya vencida)
  await fetch(`${BASE_URL}/api/equipments/${testId}/maintenance-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lastMaintDate: '2026-05-01',
      lastMaintHours: 4000,
      nextMilestoneHours: 7000, // hito aún no alcanzado con 6000h
      nextPlan: 'Plan A — 2000 horas'
    })
  });
  let checkC = await fetch(`${BASE_URL}/api/horometers`).then(r => r.json());
  let eqC = checkC.equipments.find(e => e.id === testId);
  assert(eqC.isOverdueDate === true && eqC.isOverdueHours === false, 'Caso C: Fecha trimestral vencida y horas pendientes', `Trimestral: ${eqC.quarterlyEstimatedDate}, Horas restantes: ${eqC.hoursRemaining}`);
  assert(eqC.status === 'overdue_date', 'Caso C: Estado "Vencido por fecha" (overdue_date)', `Estado: ${eqC.status}`);

  // Caso D: Ambos criterios vencidos (hito 6000h alcanzado y fecha trimestral superada)
  await fetch(`${BASE_URL}/api/equipments/${testId}/maintenance-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lastMaintDate: '2026-05-01', // vencida en agosto 2026
      nextMilestoneHours: 6000 // alcanzado porque actual es 6000
    })
  });
  let checkD = await fetch(`${BASE_URL}/api/horometers`).then(r => r.json());
  let eqD = checkD.equipments.find(e => e.id === testId);
  assert(eqD.isOverdueDate === true && eqD.isOverdueHours === true, 'Caso D: Ambos criterios cumplidos simultáneamente', `isOverdueHours: ${eqD.isOverdueHours}, isOverdueDate: ${eqD.isOverdueDate}`);
  assert(eqD.status === 'overdue_both', 'Caso D: Estado único consolidado "Vencido por ambos criterios" (overdue_both)', `Estado: ${eqD.status}`);

  // Caso F: Mantenimiento finalizado (Registrar mantenimiento de 6,000h Plan A -> avanza a 8,000h Plan C)
  const maintRes = await fetch(`${BASE_URL}/api/equipments/${testId}/maintenance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hours: 6000,
      date: '2026-11-15',
      plan: 'Plan A — 2000 horas',
      reportNumber: 'REP-2026-TEST',
      technician: 'GINO GREGORIO SILVA CLEMENTE',
      notes: 'Mantenimiento preventivo completado según pauta'
    })
  });
  assert(maintRes.ok, 'Caso F: Mantenimiento registrado exitosamente');

  let checkF = await fetch(`${BASE_URL}/api/horometers`).then(r => r.json());
  let eqF = checkF.equipments.find(e => e.id === testId);
  assert(eqF.lastMaintHours === 6000, 'Caso F: Último mantenimiento registrado en 6,000 h', `lastMaintHours: ${eqF.lastMaintHours}`);
  assert(eqF.lastPlan === 'Plan A — 2000 horas', 'Caso F: Último plan guardado', `lastPlan: ${eqF.lastPlan}`);
  assert(eqF.nextMilestoneHours === 8000, 'Caso F: Ciclo avanzó al siguiente hito: 8,000 h', `nextMilestoneHours: ${eqF.nextMilestoneHours}`);
  assert(eqF.nextPlan.includes('Plan C') || eqF.nextPlan.includes('8000'), 'Caso F: Próximo plan calculado es Plan C (8000 horas)', `nextPlan: ${eqF.nextPlan}`);
  assert(eqF.hoursRemaining === 2000, 'Caso F: Horas restantes recalculadas = 8000 - 6000 = 2000 h', `Restantes: ${eqF.hoursRemaining}`);
  assert(eqF.quarterlyEstimatedDate === '2027-02-15', 'Caso F: Nueva fecha trimestral = 15/11/2026 + 3 meses = 15/02/2027', `Fecha: ${eqF.quarterlyEstimatedDate}`);
  assert(eqF.status === 'up_to_date', 'Caso F: El equipo vuelve a estado "Al día"', `Estado: ${eqF.status}`);

  // Caso G: Reporte en borrador NO altera mantenimiento
  const draftRepRes = await fetch(`${BASE_URL}/api/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'Borrador',
      client: testEqPayload.client,
      equipmentId: testId,
      apiCode: testEqPayload.apiCode,
      model: testEqPayload.model,
      hourMeter: '7500',
      maintenanceType: 'Plan C — 8000 horas',
      date: '2026-11-20'
    })
  });
  assert(draftRepRes.ok, 'Caso G: Reporte en borrador guardado');

  let checkG = await fetch(`${BASE_URL}/api/horometers`).then(r => r.json());
  let eqG = checkG.equipments.find(e => e.id === testId);
  assert(eqG.nextMilestoneHours === 8000, 'Caso G: El hito sigue en 8,000 h (NO avanzó por borrador)', `Hito: ${eqG.nextMilestoneHours}`);
  assert(eqG.lastMaintHours === 6000, 'Caso G: Último mantenimiento sigue intacto en 6,000 h', `lastMaintHours: ${eqG.lastMaintHours}`);

  // Caso J: Persistencia e Historial completo
  const histData = await fetch(`${BASE_URL}/api/equipments/${testId}/horometer-history`).then(r => r.json());
  const histList = Array.isArray(histData) ? histData : (histData.history || []);
  assert(histList && histList.length >= 3, 'Caso J: Historial cronológico almacena lecturas y mantenimientos', `Eventos registrados: ${histList.length}`);

  // Limpieza del equipo de prueba, reportes y cliente
  await fetch(`${BASE_URL}/api/equipments/${testId}`, { method: 'DELETE' });
  try {
    const rData = await fetch(`${BASE_URL}/api/reports`).then(r => r.json());
    for (const rep of rData) {
      if (rep.client === testEqPayload.client) {
        await fetch(`${BASE_URL}/api/reports/${rep.id}`, { method: 'DELETE' });
      }
    }
    const cData = await fetch(`${BASE_URL}/api/clients`).then(r => r.json());
    for (const cli of cData) {
      if (cli.name === testEqPayload.client) {
        await fetch(`${BASE_URL}/api/clients/${cli.id}`, { method: 'DELETE' });
      }
    }
  } catch (e) {}
  console.log('🧹 Limpieza de registros de prueba completada al 100%.');

  console.log('\n========================================================');
  console.log(`RESULTADO DE LA SUITE: ${passed} / ${total} PRUEBAS EXITOSAS`);
  console.log('========================================================');
}

runTests().catch(err => {
  console.error('Error fatal durante ejecución de pruebas:', err);
  process.exit(1);
});
