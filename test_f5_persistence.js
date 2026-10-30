// ============================================================================
// INDUSTRAC S.A.C. — PRUEBA INTEGRAL DE PERSISTENCIA F5 Y SEGURIDAD E2E
// Archivo: test_f5_persistence.js
// ============================================================================

const assert = require('assert');
require('dotenv').config();

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function main() {
  console.log('\n=== SUITE E2E: PERSISTENCIA F5 Y FLUJO AUTORIZADO INDUSTRAC ===\n');

  // 1. Verificar health check del servidor
  console.log('1. Verificando estado del servidor y conexión con Supabase...');
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  assert.strictEqual(healthRes.status, 200, 'Health check debe responder 200');
  const health = await healthRes.json();
  console.log('  -> Estado del servidor:', health.status, '| Motor:', health.engine, '| Conectado:', health.supabaseConnected);
  assert.strictEqual(health.supabaseConnected, true, 'Supabase debe estar conectado');

  // 2. Verificar que peticiones anónimas son rechazadas
  console.log('\n2. Verificando protección: Petición anónima a /api/clients...');
  const anonRes = await fetch(`${BASE_URL}/api/clients`);
  assert.strictEqual(anonRes.status, 401, 'Petición anónima debe ser rechazada con 401');
  console.log('  [PASS] Acceso anónimo bloqueado con HTTP 401.');

  // 3. Inicio de sesión con credenciales autorizadas
  console.log('\n3. Iniciando sesión con credenciales de Administrador INDUSTRAC...');
  const apiSecret = (process.env.API_SECRET_KEY || '').trim();
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@industrac.com',
      password: apiSecret
    })
  });

  assert.strictEqual(loginRes.status, 200, 'Inicio de sesión debe responder 200');
  const loginData = await loginRes.json();
  assert.ok(loginData.ok && loginData.token, 'Debe devolver sesión válida');
  console.log('  -> Sesión establecida para:', loginData.user.name, `(${loginData.user.email})`);

  // Extraer cookie de sesión
  const setCookie = loginRes.headers.get('set-cookie');
  const cookieMatch = setCookie ? setCookie.match(/industrac_session=[^;]+/) : null;
  const sessionCookie = cookieMatch ? cookieMatch[0] : `industrac_session=${loginData.token}`;

  const authHeaders = {
    'Content-Type': 'application/json',
    'Cookie': sessionCookie
  };

  // 4. Crear Cliente de Prueba
  const testSuffix = Date.now().toString().slice(-5);
  const clientName = `EMPRESA PRUEBA F5 ${testSuffix} S.A.C.`;
  console.log(`\n4. Creando cliente "${clientName}"...`);
  const cliRes = await fetch(`${BASE_URL}/api/clients`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: clientName,
      address: 'Calle Industrial Los Ficus 220, Ate, Lima',
      contact: 'Ing. Prueba F5',
      notes: 'Registro temporal para prueba automatizada de persistencia'
    })
  });

  assert.strictEqual(cliRes.status, 201, 'Debe responder 201 Created al registrar cliente');
  const cliData = await cliRes.json();
  const clientId = cliData.client.id;
  console.log('  -> Cliente creado con ID:', clientId);

  // 5. Crear Equipo de Prueba
  const eqModel = `GA-55-VSD-${testSuffix}`;
  console.log(`\n5. Registrando equipo "${eqModel}" asociado al cliente...`);
  const eqRes = await fetch(`${BASE_URL}/api/equipments`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      clientId: clientId,
      client: clientName,
      model: eqModel,
      serialNumber: `SN-TEST-${testSuffix}`,
      apiCode: `API-TEST-${testSuffix}`,
      hourMeter: '2000',
      hours: 2000,
      maintenanceCycle: 'ciclo_2000'
    })
  });

  assert.strictEqual(eqRes.status, 201, 'Debe responder 201 Created al registrar equipo');
  const eqData = await eqRes.json();
  const eqId = eqData.equipment.id;
  console.log('  -> Equipo creado con ID:', eqId);

  // 6. Registrar lectura de horómetro
  console.log('\n6. Registrando nueva lectura de horómetro (2150 h)...');
  const readRes = await fetch(`${BASE_URL}/api/equipments/${eqId}/readings`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      hourMeter: 2150,
      hours: 2150,
      notes: 'Inspección técnica quincenal',
      user: 'Supervisor Técnico'
    })
  });
  assert.strictEqual(readRes.status, 200, 'Debe responder 200 al registrar lectura');
  console.log('  -> Lectura guardada exitosamente.');

  // 7. Previsualizar número de reporte (sin consumir correlativo)
  console.log('\n7. Previsualizando próximo número de reporte (peek_only=true)...');
  const peekRes = await fetch(`${BASE_URL}/api/next-report-number?peek=true`, {
    headers: authHeaders
  });
  assert.strictEqual(peekRes.status, 200);
  const peekData = await peekRes.json();
  const peekNumber = peekData.reportNumber;
  console.log('  -> Número previsualizado (no consumido):', peekNumber);
  assert.ok(peekNumber.startsWith('REP-'), 'Formato correlativo REP-AAAA-XXXX');

  // 8. Crear y Finalizar Reporte Técnico Oficial (consumiendo correlativo)
  console.log('\n8. Finalizando reporte técnico oficial...');
  const repRes = await fetch(`${BASE_URL}/api/reports`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      client: clientName,
      equipmentId: eqId,
      model: eqModel,
      serialNumber: `SN-TEST-${testSuffix}`,
      serviceType: 'Mantenimiento',
      maintenanceType: 'Plan A — 2000 horas',
      hourMeter: '2150',
      status: 'Finalizado'
    })
  });

  assert.strictEqual(repRes.status, 201, 'Debe responder 201 al crear reporte');
  const repData = await repRes.json();
  const reportId = repData.id;
  const officialReportNumber = repData.reportNumber;
  console.log('  -> Reporte finalizado con ID:', reportId, '| Número Oficial:', officialReportNumber);
  assert.ok(officialReportNumber.startsWith('REP-'), 'Número oficial generado atómicamente');

  // 9. SIMULACIÓN DE ACTUALIZACIÓN CON F5 (Consultas frescas al servidor)
  console.log('\n9. SIMULANDO RECARGA DE PÁGINA CON F5...');
  const freshClientsRes = await fetch(`${BASE_URL}/api/clients`, { headers: authHeaders });
  const freshClients = await freshClientsRes.json();
  const persistedClient = freshClients.find(c => c.id === clientId);
  assert.ok(persistedClient, 'El cliente DEBE persistir tras F5');
  console.log('  [PASS] Cliente persistente en Supabase tras F5.');

  const freshEquipmentsRes = await fetch(`${BASE_URL}/api/equipments`, { headers: authHeaders });
  const freshEquipments = await freshEquipmentsRes.json();
  const persistedEq = freshEquipments.find(e => e.id === eqId);
  assert.ok(persistedEq, 'El equipo DEBE persistir tras F5');
  assert.strictEqual(Number(persistedEq.hours), 2150, 'El horómetro del equipo debe mantenerse en 2150 h tras F5');
  console.log('  [PASS] Equipo y horómetro persistentes en Supabase tras F5.');

  const freshReportsRes = await fetch(`${BASE_URL}/api/reports`, { headers: authHeaders });
  const freshReports = await freshReportsRes.json();
  const persistedRep = freshReports.find(r => r.id === reportId);
  assert.ok(persistedRep, 'El reporte DEBE persistir en el historial tras F5');
  console.log('  [PASS] Reporte oficial persistente en Supabase tras F5.');

  // 10. Limpieza controlada de registros de prueba (0 residuo en DB)
  console.log('\n10. Limpiando registros de prueba para dejar Supabase limpio...');
  const delRepRes = await fetch(`${BASE_URL}/api/reports/${reportId}`, { method: 'DELETE', headers: authHeaders });
  assert.strictEqual(delRepRes.status, 200, 'Debe eliminar reporte');

  const delEqRes = await fetch(`${BASE_URL}/api/equipments/${eqId}`, { method: 'DELETE', headers: authHeaders });
  assert.strictEqual(delEqRes.status, 200, 'Debe eliminar equipo');

  const delCliRes = await fetch(`${BASE_URL}/api/clients/${clientId}`, { method: 'DELETE', headers: authHeaders });
  assert.strictEqual(delCliRes.status, 200, 'Debe eliminar cliente');

  // 11. Verificación definitiva de no resurrección tras nuevo F5
  const postDeleteClients = await (await fetch(`${BASE_URL}/api/clients`, { headers: authHeaders })).json();
  const resurrectedClient = postDeleteClients.find(c => c.id === clientId);
  assert.strictEqual(resurrectedClient, undefined, 'El registro eliminado NO debe resucitar tras F5');
  console.log('  [PASS] Eliminación definitiva confirmada en Supabase (0 resurrección).');

  // 12. Cierre de sesión (Logout)
  console.log('\n11. Verificando cierre de sesión seguro...');
  const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, { method: 'POST', headers: authHeaders });
  assert.strictEqual(logoutRes.status, 200);
  console.log('  [PASS] Sesión cerrada correctamente.\n');

  console.log('============================================================');
  console.log(' ¡TODAS LAS PRUEBAS DE PERSISTENCIA F5 Y SEGURIDAD SUPERADAS! ');
  console.log('============================================================\n');
}

main().catch(err => {
  console.error('\n[ERROR EN PRUEBA]:', err.message);
  process.exit(1);
});
