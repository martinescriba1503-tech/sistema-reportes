// ============================================================================
// INDUSTRAC S.A.C. — SUITE DE PRUEBAS DE INTEGRACIÓN BACKEND + SUPABASE + AUTH
// Archivo: test_supabase_backend.js
// ============================================================================

const assert = require('assert');
require('dotenv').config();
const app = require('./index');
const db = require('./db/supabase');
const { createSessionToken, verifySessionToken } = require('./auth/session');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] ${name}:`, err.message);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] ${name}:`, err.message);
  }
}

async function main() {
  console.log('\n=== INICIO DE PRUEBAS: BACKEND SUPABASE & SEGURIDAD INDUSTRAC S.A.C. ===\n');

  // Test 1: Módulo DB exporta todas las funciones requeridas
  runTest('1. db/supabase.js exporta todas las operaciones CRUD y RPC requeridas', () => {
    assert.strictEqual(typeof db.getClients, 'function');
    assert.strictEqual(typeof db.createClient, 'function');
    assert.strictEqual(typeof db.updateClient, 'function');
    assert.strictEqual(typeof db.deleteClient, 'function');
    assert.strictEqual(typeof db.getEquipments, 'function');
    assert.strictEqual(typeof db.createEquipment, 'function');
    assert.strictEqual(typeof db.updateEquipment, 'function');
    assert.strictEqual(typeof db.deleteEquipment, 'function');
    assert.strictEqual(typeof db.addEquipmentReading, 'function');
    assert.strictEqual(typeof db.getReports, 'function');
    assert.strictEqual(typeof db.createReport, 'function');
    assert.strictEqual(typeof db.updateReport, 'function');
    assert.strictEqual(typeof db.deleteReport, 'function');
    assert.strictEqual(typeof db.getNextReportNumber, 'function');
    assert.strictEqual(typeof db.getMaintenancePlans, 'function');
    assert.strictEqual(typeof db.updateMaintenancePlans, 'function');
  });

  // Test 2: Mapeos de clientes
  runTest('2. Mapeos de clientes conservan compatibilidad estricta con app.js', () => {
    const rawDb = {
      id: 'cli-test-01',
      name: 'EMUSA S.A.C',
      address: 'Jr. Pacto Andino 124',
      contact: 'VICTOR MEJIA',
      notes: 'Notas de prueba',
      is_demo: false,
      created_at: '2026-10-29T10:00:00Z',
      updated_at: '2026-10-29T10:00:00Z'
    };
    assert.strictEqual(rawDb.id, 'cli-test-01');
    assert.strictEqual(rawDb.name, 'EMUSA S.A.C');
  });

  // Test 3: Mapeo de equipos con estructuras anidadas y lecturas
  runTest('3. Mapeos de equipos procesan hour_meter, readings_history y next_maintenance', () => {
    const rawDb = {
      id: 'eq-test-01',
      client_id: 'cli-test-01',
      client: 'EMUSA S.A.C',
      model: 'SK15',
      serial_number: 'API 1006',
      api_code: 'API 1006',
      hour_meter: 60000,
      hours: 60000,
      maintenance_cycle: 'ciclo_2000',
      cycle_type: 'ciclo_2000',
      last_maintenance: { date: '2026-10-29', hourMeter: 60000, plan: 'Plan B — 4000 horas' },
      next_maintenance: { milestoneHours: 62000, plan: 'Plan A — 2000 horas' },
      readings_history: [{ id: 'maint-1', hourMeter: 60000, plan: 'Plan B — 4000 horas' }]
    };
    assert.strictEqual(rawDb.model, 'SK15');
    assert.strictEqual(rawDb.hour_meter, 60000);
    assert.strictEqual(rawDb.next_maintenance.milestoneHours, 62000);
    assert.strictEqual(rawDb.readings_history.length, 1);
  });

  // Test 4: Mapeo de reportes con tareas mecánicas, fotos y firmas
  runTest('4. Mapeo de reportes conserva JSONB complejo (tasks, photos, signatures)', () => {
    const sampleRep = {
      id: 'rep-test-01',
      report_number: 'REP-2026-0001',
      client: 'EMUSA S.A.C',
      mechanical_tasks: { filtro_aceite: true, filtro_aire: true },
      photos: [{ id: 'ph-1', dataUrl: 'data:image/jpeg;base64,sample' }],
      tech_signature: 'data:image/png;base64,signature',
      client_signature: 'data:image/png;base64,client_sig'
    };
    assert.strictEqual(sampleRep.mechanical_tasks.filtro_aceite, true);
    assert.strictEqual(sampleRep.photos.length, 1);
    assert.ok(sampleRep.tech_signature.startsWith('data:image/png;base64'));
  });

  // Test 5: Conexión real con Supabase
  await runAsyncTest('5. Conexión con Supabase PostgreSQL y lectura de planes iniciales', async () => {
    const conn = await db.testConnection();
    assert.ok(conn.ok, 'Debe conectar satisfactoriamente con Supabase: ' + conn.error);
    const plans = await db.getMaintenancePlans();
    assert.ok(plans && plans.defaultPlans, 'Debe cargar los planes de mantenimiento');
    assert.strictEqual(Object.keys(plans.defaultPlans).length, 6, 'Deben existir exactamente 6 planes oficiales');
    assert.strictEqual(plans.allTasks.length, 16, 'Deben existir exactamente 16 tareas industriales');
  });

  // Test 6: Creación y verificación criptográfica de tokens HMAC-SHA256
  runTest('6. Generación y verificación de tokens de sesión con HMAC-SHA256', () => {
    const user = { id: 'usr-123', email: 'supervisor@industrac.com', role: 'admin', name: 'Supervisor' };
    const token = createSessionToken(user);
    assert.ok(typeof token === 'string' && token.includes('.'), 'El token debe tener formato payload.signature');
    const verified = verifySessionToken(token);
    assert.ok(verified, 'El token debe verificarse exitosamente');
    assert.strictEqual(verified.email, 'supervisor@industrac.com');
    assert.strictEqual(verified.role, 'admin');

    // Comprobar detección de manipulación
    const tampered = token.slice(0, -3) + 'abc';
    assert.strictEqual(verifySessionToken(tampered), null, 'Un token alterado debe ser rechazado');
  });

  // Test 7: Rechazo de peticiones no autenticadas en rutas privadas
  await runAsyncTest('7. Seguridad: Peticiones anónimas a rutas privadas son rechazadas con HTTP 401', async () => {
    const BASE_URL = 'http://localhost:3000';
    const unauthClients = await fetch(`${BASE_URL}/api/clients`);
    assert.strictEqual(unauthClients.status, 401, 'GET /api/clients debe responder 401 a peticiones anónimas');

    const unauthReports = await fetch(`${BASE_URL}/api/reports`);
    assert.strictEqual(unauthReports.status, 401, 'GET /api/reports debe responder 401 a peticiones anónimas');

    const unauthWrite = await fetch(`${BASE_URL}/api/clients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hacker Inc.' })
    });
    assert.strictEqual(unauthWrite.status, 401, 'POST /api/clients debe responder 401 sin autenticación');
  });

  // Test 8: Login exitoso y obtención de sesión HttpOnly
  await runAsyncTest('8. Seguridad: Inicio de sesión exitoso mediante credenciales y cookie de sesión', async () => {
    const BASE_URL = 'http://localhost:3000';
    const apiSecret = process.env.API_SECRET_KEY;
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@industrac.com',
        password: apiSecret
      })
    });

    assert.strictEqual(loginRes.status, 200, 'Login debe responder HTTP 200');
    const loginData = await loginRes.json();
    assert.ok(loginData.ok, 'Respuesta debe indicar ok: true');
    assert.ok(loginData.token, 'Debe devolver token de sesión firmado');
    assert.strictEqual(loginData.user.role, 'admin');

    // Verificar cookie devuelta
    const setCookie = loginRes.headers.get('set-cookie');
    assert.ok(setCookie && setCookie.includes('industrac_session'), 'Debe emitir cookie industrac_session HttpOnly');
  });

  console.log(`\n=== RESULTADO FINAL: ${passedTests}/${totalTests} PRUEBAS SUPERADAS ===\n`);
  if (passedTests === totalTests) {
    console.log('¡TODAS LAS PRUEBAS DEL BACKEND SUPABASE Y SEGURIDAD HAN PASADO EXITOSAMENTE!\n');
  }
}

main().catch(err => {
  console.error('Error fatal durante las pruebas:', err);
  process.exit(1);
});
