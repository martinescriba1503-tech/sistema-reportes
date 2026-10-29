// test_casos_1_10.js
// Validación completa de los 10 CASOS OBLIGATORIOS para el Módulo de Horómetros Rediseñado

const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const EQUIPMENTS_FILE = path.join(__dirname, 'data', 'equipments.json');
const REPORTS_FILE = path.join(__dirname, 'data', 'reports.json');
const CLIENTS_FILE = path.join(__dirname, 'data', 'clients.json');

async function runTests() {
  console.log('================================================================');
  console.log('INDUSTRAC S.A.C. — VALIDACIÓN DE LOS 10 CASOS OBLIGATORIOS');
  console.log('================================================================\n');

  let passedCount = 0;
  const totalTests = 10;

  // Snapshot original files to ensure complete isolation and zero corruption
  const originalEquipments = fs.readFileSync(EQUIPMENTS_FILE, 'utf8');
  const originalReports = fs.readFileSync(REPORTS_FILE, 'utf8');
  const originalClients = fs.readFileSync(CLIENTS_FILE, 'utf8');

  try {
    // -------------------------------------------------------------
    // CASO 1: Registrar un mantenimiento para un equipo existente.
    //         Verificar que el dashboard se actualice automáticamente.
    // -------------------------------------------------------------
    console.log('--- CASO 1: Registro de servicio e integración automática al dashboard ---');
    const eqListRes = await fetch(`${BASE_URL}/api/horometers?mode=real`);
    const eqListData = await eqListRes.json();
    const targetEq = eqListData.equipments[0];
    if (!targetEq) throw new Error('No hay equipos disponibles para probar Caso 1');

    const newServiceHours = (Number(targetEq.currentHours || 1000) + 200);
    const testRepNum = `REP-TEST-C1-${Date.now()}`;
    const reportPayload = {
      reportNumber: testRepNum,
      client: targetEq.client,
      equipmentId: targetEq.id,
      model: targetEq.model,
      serialNumber: targetEq.serialNumber || 'SN-TEST-C1',
      date: '2026-10-28', // Fecha posterior a la registrada actualmente
      hourMeter: String(newServiceHours),
      maintenanceType: 'Plan A — 2000 horas',
      status: 'Finalizado'
    };

    const postRepRes = await fetch(`${BASE_URL}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reportPayload)
    });
    if (!postRepRes.ok) throw new Error('Error al registrar reporte de servicio');

    // Consultar el dashboard /api/horometers inmediatamente
    const dashRes = await fetch(`${BASE_URL}/api/horometers?mode=real`);
    const dashData = await dashRes.json();
    const updatedEq = dashData.equipments.find(e => e.id === targetEq.id);

    if (
      updatedEq &&
      updatedEq.lastServiceDate === '2026-10-28' &&
      Number(updatedEq.lastHorometer) === newServiceHours &&
      updatedEq.lastMaintenanceType === '2,000 h'
    ) {
      console.log('✅ [PASÓ] CASO 1: Servicio registrado actualizó automáticamente el dashboard.');
      console.log(`   Último servicio: ${updatedEq.lastServiceDate}, Horómetro: ${updatedEq.lastHorometer} h, Tipo: ${updatedEq.lastMaintenanceType}`);
      passedCount++;
    } else {
      console.error('❌ [FALLÓ] CASO 1: El dashboard no reflejó los datos actualizados.', {
        lastServiceDate: updatedEq?.lastServiceDate,
        lastHorometer: updatedEq?.lastHorometer,
        lastMaintenanceType: updatedEq?.lastMaintenanceType
      });
    }

    // -------------------------------------------------------------
    // CASO 2: Registrar un servicio el 15/10/2026.
    //         Verificar que la fecha estimada sea 15/01/2027.
    // -------------------------------------------------------------
    console.log('\n--- CASO 2: Cálculo de fecha estimada para 15/10/2026 -> 15/01/2027 ---');
    const eq2Id = `eq-test-caso2-${Date.now()}`;
    const eq2Payload = {
      id: eq2Id,
      client: 'CLIENTE PRUEBA CASO 2',
      model: 'COMPRESOR C2 50HP',
      serialNumber: 'SN-CASO2',
      hourMeter: '2000',
      maintenanceCycle: 'ciclo_2000',
      lastMaintenance: {
        date: '2026-10-15',
        hourMeter: 2000,
        plan: 'Plan A — 2000 horas'
      }
    };

    const eqCreateRes = await fetch(`${BASE_URL}/api/equipments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eq2Payload)
    });
    if (!eqCreateRes.ok) throw new Error('Error creando equipo Caso 2');

    const dash2Res = await fetch(`${BASE_URL}/api/horometers?mode=real`);
    const dash2Data = await dash2Res.json();
    const item2 = dash2Data.equipments.find(e => e.id === eq2Id);

    if (item2 && item2.estimatedDate === '2027-01-15') {
      console.log('✅ [PASÓ] CASO 2: Fecha del 15/10/2026 genera exactamente 15/01/2027 (+3 meses).');
      console.log(`   Último servicio: ${item2.lastServiceDate} -> Fecha estimada (+3 meses): ${item2.estimatedDate}`);
      passedCount++;
    } else {
      console.error('❌ [FALLÓ] CASO 2: Fecha estimada esperada 2027-01-15, recibida:', item2?.estimatedDate);
    }

    // -------------------------------------------------------------
    // CASO 3: Registrar un servicio el 31/10/2026.
    //         Verificar que la fecha estimada sea 31/01/2027.
    // -------------------------------------------------------------
    console.log('\n--- CASO 3: Cálculo de fecha estimada para 31/10/2026 -> 31/01/2027 ---');
    const eq3Id = `eq-test-caso3-${Date.now()}`;
    const eq3Payload = {
      id: eq3Id,
      client: 'CLIENTE PRUEBA CASO 3',
      model: 'COMPRESOR C3 75HP',
      serialNumber: 'SN-CASO3',
      hourMeter: '4000',
      maintenanceCycle: 'ciclo_2000',
      lastMaintenance: {
        date: '2026-10-31',
        hourMeter: 4000,
        plan: 'Plan B — 4000 horas'
      }
    };

    await fetch(`${BASE_URL}/api/equipments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eq3Payload)
    });

    const dash3Res = await fetch(`${BASE_URL}/api/horometers?mode=real`);
    const dash3Data = await dash3Res.json();
    const item3 = dash3Data.equipments.find(e => e.id === eq3Id);

    if (item3 && item3.estimatedDate === '2027-01-31') {
      console.log('✅ [PASÓ] CASO 3: Fecha del 31/10/2026 genera exactamente 31/01/2027 (+3 meses).');
      console.log(`   Último servicio: ${item3.lastServiceDate} -> Fecha estimada (+3 meses): ${item3.estimatedDate}`);
      passedCount++;
    } else {
      console.error('❌ [FALLÓ] CASO 3: Fecha estimada esperada 2027-01-31, recibida:', item3?.estimatedDate);
    }

    // -------------------------------------------------------------
    // CASO 4: Registrar un mantenimiento de 2,000 horas.
    //         Verificar que el siguiente respete la secuencia acumulada.
    //         (2,000 h -> 4,000 h -> 2,000 h -> 8,000 h)
    // -------------------------------------------------------------
    console.log('\n--- CASO 4: Secuencia acumulada tras 2,000 h (SECUENCIA A) ---');
    const eq4Id = `eq-test-caso4-${Date.now()}`;
    const eq4Payload = {
      id: eq4Id,
      client: 'CLIENTE PRUEBA CASO 4',
      model: 'COMPRESOR C4 100HP',
      serialNumber: 'SN-CASO4',
      hourMeter: '6000',
      maintenanceCycle: 'ciclo_2000',
      readingsHistory: [
        { date: '2026-01-10', hourMeter: 4000, plan: 'Plan B — 4000 horas', type: 'mantenimiento' },
        { date: '2026-05-15', hourMeter: 6000, plan: 'Plan A — 2000 horas', type: 'mantenimiento' }
      ],
      lastMaintenance: {
        date: '2026-05-15',
        hourMeter: 6000,
        plan: 'Plan A — 2000 horas'
      }
    };

    await fetch(`${BASE_URL}/api/equipments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eq4Payload)
    });

    const dash4Res = await fetch(`${BASE_URL}/api/horometers?mode=real`);
    const dash4Data = await dash4Res.json();
    const item4 = dash4Data.equipments.find(e => e.id === eq4Id);

    // Como el anterior fue 4,000 h y el último fue 2,000 h, el siguiente DEBE ser 8,000 h
    if (item4 && item4.nextServiceType === '8,000 h') {
      console.log('✅ [PASÓ] CASO 4: Tras 4,000 h seguido de 2,000 h, el siguiente servicio es 8,000 h.');
      console.log(`   Historial: 4,000 h -> 2,000 h -> Próximo servicio calculado: ${item4.nextServiceType}`);
      passedCount++;
    } else {
      console.error('❌ [FALLÓ] CASO 4: Próximo servicio esperado 8,000 h, recibido:', item4?.nextServiceType);
    }

    // -------------------------------------------------------------
    // CASO 5: Registrar un mantenimiento de 4,000 horas.
    //         Verificar que el siguiente corresponda al ciclo (2,000 h).
    // -------------------------------------------------------------
    console.log('\n--- CASO 5: Transición desde mantenimiento de 4,000 horas ---');
    const eq5Id = `eq-test-caso5-${Date.now()}`;
    const eq5Payload = {
      id: eq5Id,
      client: 'CLIENTE PRUEBA CASO 5',
      model: 'COMPRESOR C5 40HP',
      serialNumber: 'SN-CASO5',
      hourMeter: '4000',
      maintenanceCycle: 'ciclo_2000',
      lastMaintenance: {
        date: '2026-07-20',
        hourMeter: 4000,
        plan: 'Plan B — 4000 horas'
      }
    };

    await fetch(`${BASE_URL}/api/equipments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eq5Payload)
    });

    const dash5Res = await fetch(`${BASE_URL}/api/horometers?mode=real`);
    const dash5Data = await dash5Res.json();
    const item5 = dash5Data.equipments.find(e => e.id === eq5Id);

    if (item5 && item5.nextServiceType === '2,000 h') {
      console.log('✅ [PASÓ] CASO 5: Tras un mantenimiento de 4,000 h, el siguiente servicio es 2,000 h.');
      console.log(`   Último mantenimiento: ${item5.lastMaintenanceType} -> Próximo servicio: ${item5.nextServiceType}`);
      passedCount++;
    } else {
      console.error('❌ [FALLÓ] CASO 5: Próximo servicio esperado 2,000 h, recibido:', item5?.nextServiceType);
    }

    // -------------------------------------------------------------
    // CASO 6: Verificar el funcionamiento del ciclo de 3,000,
    //         6,000 y 12,000 horas (SECUENCIA B).
    // -------------------------------------------------------------
    console.log('\n--- CASO 6: Funcionamiento de SECUENCIA B (3k -> 6k -> 3k -> 12k) ---');
    const eq6Id = `eq-test-caso6-${Date.now()}`;
    const eq6Payload = {
      id: eq6Id,
      client: 'CLIENTE PRUEBA CASO 6',
      model: 'COMPRESOR C6 CICLO 3K',
      serialNumber: 'SN-CASO6',
      hourMeter: '9000',
      maintenanceCycle: 'ciclo_3000',
      cycleType: 'ciclo_3000',
      readingsHistory: [
        { date: '2025-06-01', hourMeter: 6000, plan: 'Plan B — 6000 horas', type: 'mantenimiento' },
        { date: '2026-01-10', hourMeter: 9000, plan: 'Plan A — 3000 horas', type: 'mantenimiento' }
      ],
      lastMaintenance: {
        date: '2026-01-10',
        hourMeter: 9000,
        plan: 'Plan A — 3000 horas'
      }
    };

    await fetch(`${BASE_URL}/api/equipments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eq6Payload)
    });

    const dash6Res = await fetch(`${BASE_URL}/api/horometers?mode=real`);
    const dash6Data = await dash6Res.json();
    const item6 = dash6Data.equipments.find(e => e.id === eq6Id);

    // En el ciclo de 3k: tras 6,000 h y luego 3,000 h, el siguiente servicio DEBE ser 12,000 h
    if (item6 && item6.nextServiceType === '12,000 h') {
      console.log('✅ [PASÓ] CASO 6: SECUENCIA B tras 6,000 h + 3,000 h calcula correctamente 12,000 h.');
      console.log(`   Ciclo: ${item6.cycleType || 'ciclo_3000'} | Historial: 6,000 h -> 3,000 h -> Próximo: ${item6.nextServiceType}`);
      passedCount++;
    } else {
      console.error('❌ [FALLÓ] CASO 6: Próximo servicio esperado 12,000 h, recibido:', item6?.nextServiceType);
    }

    // -------------------------------------------------------------
    // CASO 7: Registrar un servicio para un equipo y verificar
    //         que ningún otro equipo resulte modificado.
    // -------------------------------------------------------------
    console.log('\n--- CASO 7: Aislamiento estricto de equipos al registrar servicio ---');
    const beforeRes = await fetch(`${BASE_URL}/api/horometers?mode=real`);
    const beforeData = await beforeRes.json();
    const unaffectedEq = beforeData.equipments.find(e => e.id !== eq2Id && e.id !== eq3Id && e.id !== eq4Id && e.id !== eq5Id && e.id !== eq6Id);

    const snapshotUnaffected = JSON.stringify({
      id: unaffectedEq.id,
      lastHorometer: unaffectedEq.lastHorometer,
      lastServiceDate: unaffectedEq.lastServiceDate,
      nextServiceType: unaffectedEq.nextServiceType
    });

    // Registrar servicio para eq2Id
    const repC7Payload = {
      reportNumber: `REP-C7-${Date.now()}`,
      client: 'CLIENTE PRUEBA CASO 2',
      equipmentId: eq2Id,
      date: '2026-10-22',
      hourMeter: '2500',
      maintenanceType: 'Plan B — 4000 horas',
      status: 'Finalizado'
    };
    await fetch(`${BASE_URL}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(repC7Payload)
    });

    const afterRes = await fetch(`${BASE_URL}/api/horometers?mode=real`);
    const afterData = await afterRes.json();
    const unaffectedAfter = afterData.equipments.find(e => e.id === unaffectedEq.id);

    const snapshotAfter = JSON.stringify({
      id: unaffectedAfter.id,
      lastHorometer: unaffectedAfter.lastHorometer,
      lastServiceDate: unaffectedAfter.lastServiceDate,
      nextServiceType: unaffectedAfter.nextServiceType
    });

    if (snapshotUnaffected === snapshotAfter) {
      console.log('✅ [PASÓ] CASO 7: La actualización del equipo objetivo NO modificó ningún otro equipo.');
      console.log(`   Equipo no afectado: ${unaffectedEq.client} [${unaffectedEq.id}] permaneció idéntico.`);
      passedCount++;
    } else {
      console.error('❌ [FALLÓ] CASO 7: Otro equipo resultó alterado inadvertidamente.');
    }

    // -------------------------------------------------------------
    // CASO 8: Actualizar la página y comprobar que los datos
    //         persistan correctamente.
    // -------------------------------------------------------------
    console.log('\n--- CASO 8: Persistencia en disco (equipments.json) tras reinicio/recarga ---');
    const fileContent = fs.readFileSync(EQUIPMENTS_FILE, 'utf8');
    const parsedFileEquipments = JSON.parse(fileContent);
    const persistedEq2 = parsedFileEquipments.find(e => e.id === eq2Id);

    if (persistedEq2 && persistedEq2.lastMaintenance && persistedEq2.lastMaintenance.date === '2026-10-22') {
      console.log('✅ [PASÓ] CASO 8: Los datos están efectivamente persistidos en el almacenamiento JSON.');
      console.log(`   Lectura directa de disco: Equipo ${persistedEq2.id} tiene fecha ${persistedEq2.lastMaintenance.date} y horómetro ${persistedEq2.lastMaintenance.hourMeter} h.`);
      passedCount++;
    } else {
      console.error('❌ [FALLÓ] CASO 8: No se encontraron los datos persistidos en disco.', persistedEq2);
    }

    // -------------------------------------------------------------
    // CASO 9: Comprobar que el modo demostración no contamine
    //         los datos reales.
    // -------------------------------------------------------------
    console.log('\n--- CASO 9: Aislamiento total de Modo Demostración vs Modo Real ---');
    const demoRes = await fetch(`${BASE_URL}/api/horometers?mode=demo`);
    const demoData = await demoRes.json();
    const demoHasRealEq = demoData.equipments.some(e => e.id === eq2Id);

    const realRes = await fetch(`${BASE_URL}/api/horometers?mode=real`);
    const realData = await realRes.json();
    const realHasDemoEq = realData.equipments.some(e => e.isDemo === true);

    if (!demoHasRealEq && !realHasDemoEq) {
      console.log('✅ [PASÓ] CASO 9: Modo demostración y modo real completamente aislados.');
      console.log(`   Equipos Reales: ${realData.equipments.length} (0 demos) | Equipos Demo: ${demoData.equipments.length} (0 reales)`);
      passedCount++;
    } else {
      console.error('❌ [FALLÓ] CASO 9: Contaminación entre modo demo y real detectada.', { demoHasRealEq, realHasDemoEq });
    }

    // -------------------------------------------------------------
    // CASO 10: Verificar que los registros históricos y la sincronización
    //          existente continúen funcionando.
    // -------------------------------------------------------------
    console.log('\n--- CASO 10: Registros históricos y compatibilidad con sincronización ---');
    const reportsRes = await fetch(`${BASE_URL}/api/reports`);
    const reportsData = await reportsRes.json();
    const hasHistory = Array.isArray(reportsData) && reportsData.length > 0;

    const sampleRep = reportsData[0];
    const hasSyncFields = sampleRep && (sampleRep.reportNumber !== undefined) && (sampleRep.status !== undefined);

    if (hasHistory && hasSyncFields) {
      console.log('✅ [PASÓ] CASO 10: El historial de servicios y estructuras de sincronización operan con normalidad.');
      console.log(`   Total de reportes históricos: ${reportsData.length}, Muestreado: ${sampleRep.reportNumber} (${sampleRep.status})`);
      passedCount++;
    } else {
      console.error('❌ [FALLÓ] CASO 10: Historial o campos de sincronización comprometidos.');
    }

  } catch (err) {
    console.error('Excepción crítica durante la ejecución de pruebas:', err);
  } finally {
    // Restaurar los archivos JSON a su estado limpio original
    fs.writeFileSync(EQUIPMENTS_FILE, originalEquipments, 'utf8');
    fs.writeFileSync(REPORTS_FILE, originalReports, 'utf8');
    fs.writeFileSync(CLIENTS_FILE, originalClients, 'utf8');
    console.log('\n🧹 Archivos JSON restaurados a su estado original para preservar la integridad de producción.');
  }

  console.log('\n================================================================');
  console.log(`RESUMEN FINAL: ${passedCount} / ${totalTests} CASOS OBLIGATORIOS EXITOSOS`);
  console.log('================================================================\n');

  if (passedCount === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests();
