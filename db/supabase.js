// ============================================================================
// INDUSTRAC S.A.C. — CAPA DE PERSISTENCIA SUPABASE POSTGRESQL
// Módulo: db/supabase.js
// Conexión exclusiva desde Backend Node.js utilizando SUPABASE_SECRET_KEY
// ============================================================================

const { createClient: createSupabaseClient } = require('@supabase/supabase-js');
require('dotenv').config();

let supabase = null;

function getSupabase() {
  if (supabase) return supabase;

  const rawUrl = process.env.SUPABASE_URL;
  const url = rawUrl ? rawUrl.trim() : null;
  const key = (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_SECRET ||
    process.env.SUPABASE_SERVICE_KEY ||
    ''
  ).trim() || null;

  if (url && key) {
    try {
      supabase = createSupabaseClient(url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      });
      console.log('[Supabase] Cliente inicializado correctamente con credenciales oficiales.');
      return supabase;
    } catch (err) {
      console.error('[Supabase] Error al inicializar createClient:', err.message);
    }
  } else {
    console.warn('[Supabase] ATENCIÓN: SUPABASE_URL y/o SUPABASE_SECRET_KEY no están definidas en las variables de entorno.');
  }
  return null;
}

supabase = getSupabase();

function getClientOrThrow() {
  const client = getSupabase();
  if (!client) {
    const error = new Error('Base de datos no configurada: SUPABASE_URL o SUPABASE_SECRET_KEY ausente.');
    error.status = 503;
    throw error;
  }
  return client;
}

// ----------------------------------------------------------------------------
// MAPEOS BIDIRECCIONALES (snake_case DB <-> camelCase Frontend)
// ----------------------------------------------------------------------------

function toClient(db) {
  if (!db) return null;
  return {
    id: db.id,
    name: db.name || '',
    address: db.address || '',
    contact: db.contact || '',
    notes: db.notes || '',
    isDemo: Boolean(db.is_demo),
    createdAt: db.created_at,
    updatedAt: db.updated_at
  };
}

function toDbClient(client) {
  return {
    id: client.id,
    name: client.name,
    address: client.address || '',
    contact: client.contact || '',
    notes: client.notes || '',
    is_demo: Boolean(client.isDemo),
    created_at: client.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

function toEquipment(db) {
  if (!db) return null;
  return {
    id: db.id,
    clientId: db.client_id || '',
    client: db.client || '',
    address: db.address || '',
    manufacturer: db.manufacturer || '',
    model: db.model || '',
    serialNumber: db.serial_number || '',
    apiCode: db.api_code || '',
    controller: db.controller || '',
    pressure: db.pressure || '',
    airflow: db.airflow || '',
    oilType: db.oil_type || '',
    hourMeter: db.hour_meter !== null && db.hour_meter !== undefined ? String(db.hour_meter) : '0',
    hours: Number(db.hours || db.hour_meter || 0),
    maintenanceCycle: db.maintenance_cycle || 'ciclo_2000',
    cycleType: db.cycle_type || 'ciclo_2000',
    alertThresholdHours: Number(db.alert_threshold_hours || 200),
    monthlyAverageHours: db.monthly_average_hours !== null && db.monthly_average_hours !== undefined ? Number(db.monthly_average_hours) : null,
    location: db.location || '',
    status: db.status || 'Activo',
    active: db.active !== false,
    notes: db.notes || '',
    isDemo: Boolean(db.is_demo),
    lastMaintenance: db.last_maintenance || null,
    nextMaintenance: db.next_maintenance || null,
    readingsHistory: Array.isArray(db.readings_history) ? db.readings_history : [],
    lastReadingDate: db.last_reading_date || null,
    createdAt: db.created_at,
    updatedAt: db.updated_at
  };
}

function toDbEquipment(eq) {
  return {
    id: eq.id,
    client_id: eq.clientId || null,
    client: eq.client || '',
    address: eq.address || '',
    manufacturer: eq.manufacturer || '',
    model: eq.model || '',
    serial_number: eq.serialNumber || '',
    api_code: eq.apiCode || '',
    controller: eq.controller || '',
    pressure: eq.pressure || '',
    airflow: eq.airflow || '',
    oil_type: eq.oilType || '',
    hour_meter: Number(eq.hourMeter || eq.hours || 0),
    hours: Number(eq.hours || eq.hourMeter || 0),
    maintenance_cycle: eq.maintenanceCycle || 'ciclo_2000',
    cycle_type: eq.cycleType || eq.maintenanceCycle || 'ciclo_2000',
    alert_threshold_hours: Number(eq.alertThresholdHours || 200),
    monthly_average_hours: eq.monthlyAverageHours !== undefined && eq.monthlyAverageHours !== null ? Number(eq.monthlyAverageHours) : null,
    location: eq.location || '',
    status: eq.status || 'Activo',
    active: eq.active !== false,
    notes: eq.notes || '',
    is_demo: Boolean(eq.isDemo),
    last_maintenance: eq.lastMaintenance || null,
    next_maintenance: eq.nextMaintenance || null,
    readings_history: Array.isArray(eq.readingsHistory) ? eq.readingsHistory : [],
    last_reading_date: eq.lastReadingDate || null,
    created_at: eq.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

function toReport(db, summaryOnly = false) {
  if (!db) return null;
  const base = {
    id: db.id,
    reportNumber: db.report_number,
    date: db.date,
    client: db.client,
    equipmentId: db.equipment_id,
    apiCode: db.api_code,
    address: db.address,
    technician: db.technician,
    serviceType: db.service_type,
    maintenanceType: db.maintenance_type,
    model: db.model,
    serialNumber: db.serial_number,
    controller: db.controller,
    pressure: db.pressure,
    airflow: db.airflow,
    hourMeter: db.hour_meter !== null && db.hour_meter !== undefined ? String(db.hour_meter) : '',
    status: db.status || 'Finalizado',
    createdAt: db.created_at,
    updatedAt: db.updated_at,
    pdfDriveUrl: db.pdf_drive_url || '',
    pdfDriveDownloadUrl: db.pdf_drive_download_url || ''
  };

  if (summaryOnly) {
    return base;
  }

  return {
    ...base,
    oilType: db.oil_type || '',
    oilQuantities: db.oil_quantities || {},
    oilLevel: db.oil_level || '',
    customOil: db.custom_oil || '',
    manufacturer: db.manufacturer || '',
    mechanicalTasks: db.mechanical_tasks || {},
    otherMechanicalTasks: db.other_mechanical_tasks || '',
    pendingTasksReason: db.pending_tasks_reason || '',
    hasElectrical: Boolean(db.has_electrical),
    electrical: db.electrical || {},
    mainMotor: db.main_motor || {},
    fanMotor: db.fan_motor || {},
    hasDryer: Boolean(db.has_dryer),
    dryer: db.dryer || {},
    serviceLives: db.service_lives || {},
    regulations: db.regulations || {},
    technicalParameters: db.technical_parameters || {},
    observations: db.observations || '',
    recommendations: db.recommendations || '',
    photos: Array.isArray(db.photos) ? db.photos : [],
    techSignature: db.tech_signature || '',
    techName: db.tech_name || '',
    clientSignature: db.client_signature || '',
    clientSignerName: db.client_signer_name || '',
    clientSignerPosition: db.client_signer_position || '',
    draftSavedOn: db.draft_saved_on || null
  };
}

function toDbReport(rep) {
  return {
    id: rep.id,
    report_number: rep.reportNumber,
    date: rep.date || new Date().toISOString().split('T')[0],
    client: rep.client || '',
    equipment_id: rep.equipmentId || null,
    api_code: rep.apiCode || '',
    address: rep.address || '',
    technician: rep.technician || '',
    service_type: rep.serviceType || 'Mantenimiento',
    maintenance_type: rep.maintenanceType || '',
    model: rep.model || '',
    serial_number: rep.serialNumber || '',
    controller: rep.controller || '',
    pressure: rep.pressure || '',
    airflow: rep.airflow || '',
    hour_meter: Number(rep.hourMeter || 0),
    oil_type: rep.oilType || '',
    oil_quantities: rep.oilQuantities || {},
    oil_level: rep.oilLevel || '',
    custom_oil: rep.customOil || '',
    manufacturer: rep.manufacturer || '',
    mechanical_tasks: rep.mechanicalTasks || {},
    other_mechanical_tasks: rep.otherMechanicalTasks || '',
    pending_tasks_reason: rep.pendingTasksReason || '',
    has_electrical: Boolean(rep.hasElectrical),
    electrical: rep.electrical || {},
    main_motor: rep.mainMotor || {},
    fan_motor: rep.fanMotor || {},
    has_dryer: Boolean(rep.hasDryer),
    dryer: rep.dryer || {},
    service_lives: rep.serviceLives || {},
    regulations: rep.regulations || {},
    technical_parameters: rep.technicalParameters || {},
    observations: rep.observations || '',
    recommendations: rep.recommendations || '',
    photos: Array.isArray(rep.photos) ? rep.photos : [],
    tech_signature: rep.techSignature || '',
    tech_name: rep.techName || '',
    client_signature: rep.clientSignature || '',
    client_signer_name: rep.clientSignerName || '',
    client_signer_position: rep.clientSignerPosition || '',
    status: rep.status || 'Finalizado',
    draft_saved_on: rep.draftSavedOn || null,
    pdf_drive_url: rep.pdfDriveUrl || '',
    pdf_drive_download_url: rep.pdfDriveDownloadUrl || '',
    created_at: rep.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

// ----------------------------------------------------------------------------
// OPERACIONES CRUD — CLIENTES
// ----------------------------------------------------------------------------

async function getClients() {
  const sb = getClientOrThrow();
  const { data, error } = await sb
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(toClient);
}

async function getClientById(id) {
  const sb = getClientOrThrow();
  const { data, error } = await sb
    .from('clients')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // No encontrado
    throw error;
  }
  return toClient(data);
}

async function createClient(clientData) {
  const sb = getClientOrThrow();
  const row = toDbClient(clientData);
  const { data, error } = await sb
    .from('clients')
    .insert([row])
    .select()
    .single();

  if (error) throw error;
  return toClient(data);
}

async function updateClient(id, clientData) {
  const sb = getClientOrThrow();
  const row = toDbClient({ ...clientData, id });
  const { data, error } = await sb
    .from('clients')
    .update(row)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toClient(data);
}

async function deleteClient(id) {
  const sb = getClientOrThrow();
  const { error } = await sb
    .from('clients')
    .delete()
    .eq('id', id);

  if (error) throw error;
  return true;
}

// ----------------------------------------------------------------------------
// OPERACIONES CRUD — EQUIPOS
// ----------------------------------------------------------------------------

async function getEquipments() {
  const sb = getClientOrThrow();
  const { data, error } = await sb
    .from('equipments')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(toEquipment);
}

async function getEquipmentById(id) {
  const sb = getClientOrThrow();
  const { data, error } = await sb
    .from('equipments')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return toEquipment(data);
}

async function createEquipment(equipmentData) {
  const sb = getClientOrThrow();
  const row = toDbEquipment(equipmentData);
  const { data, error } = await sb
    .from('equipments')
    .insert([row])
    .select()
    .single();

  if (error) throw error;
  return toEquipment(data);
}

async function updateEquipment(id, equipmentData) {
  const sb = getClientOrThrow();
  const row = toDbEquipment({ ...equipmentData, id });
  const { data, error } = await sb
    .from('equipments')
    .update(row)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toEquipment(data);
}

async function deleteEquipment(id) {
  const sb = getClientOrThrow();
  const { error } = await sb
    .from('equipments')
    .delete()
    .eq('id', id);

  if (error) throw error;
  return true;
}

async function addEquipmentReading(equipmentId, reading) {
  const sb = getClientOrThrow();

  // 1. Obtener equipo actual
  const eq = await getEquipmentById(equipmentId);
  if (!eq) throw new Error('Equipo no encontrado');

  // 2. Insertar en tabla hourmeter_readings
  const readingId = reading.id || `maint-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const readingRow = {
    id: readingId,
    equipment_id: equipmentId,
    date: reading.date || new Date().toISOString().split('T')[0],
    hour_meter: Number(reading.hourMeter || reading.hours || 0),
    hours: Number(reading.hours || reading.hourMeter || 0),
    type: reading.type || 'mantenimiento',
    plan: reading.plan || '',
    report_number: reading.reportNumber || '',
    notes: reading.notes || '',
    user_name: reading.user || reading.userName || '',
    created_at: new Date().toISOString()
  };

  const { error: readErr } = await sb.from('hourmeter_readings').insert([readingRow]);
  if (readErr) throw readErr;

  // 3. Actualizar readingsHistory y horas en el equipo
  const history = Array.isArray(eq.readingsHistory) ? [...eq.readingsHistory] : [];
  history.push({
    id: readingId,
    date: readingRow.date,
    hourMeter: readingRow.hour_meter,
    hours: readingRow.hours,
    type: readingRow.type,
    plan: readingRow.plan,
    reportNumber: readingRow.report_number,
    notes: readingRow.notes,
    user: readingRow.user_name
  });

  const updatedEq = {
    ...eq,
    hourMeter: String(readingRow.hour_meter),
    hours: readingRow.hours,
    lastReadingDate: readingRow.date,
    readingsHistory: history
  };

  return await updateEquipment(equipmentId, updatedEq);
}

async function deleteEquipmentReading(equipmentId, readingId) {
  const sb = getClientOrThrow();

  // 1. Eliminar de hourmeter_readings
  await sb.from('hourmeter_readings').delete().eq('id', readingId);

  // 2. Eliminar del array en el equipo
  const eq = await getEquipmentById(equipmentId);
  if (!eq) return null;

  const history = (eq.readingsHistory || []).filter(r => r.id !== readingId);
  return await updateEquipment(equipmentId, { ...eq, readingsHistory: history });
}

// ----------------------------------------------------------------------------
// OPERACIONES CRUD — REPORTES
// ----------------------------------------------------------------------------

async function getReports(filters = {}) {
  const sb = getClientOrThrow();
  let query = sb
    .from('reports')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters.status && filters.status !== 'all') {
    query = query.ilike('status', filters.status);
  } else if (!filters.status) {
    query = query.eq('status', 'Finalizado');
  }

  const { data, error } = await query;
  if (error) throw error;

  const summaryOnly = filters.summary === true || filters.summary === 'true';
  return (data || []).map(r => toReport(r, summaryOnly));
}

async function getReportById(id) {
  const sb = getClientOrThrow();
  const { data, error } = await sb
    .from('reports')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return toReport(data, false);
}

async function createReport(reportData) {
  const sb = getClientOrThrow();
  const row = toDbReport(reportData);
  const { data, error } = await sb
    .from('reports')
    .insert([row])
    .select()
    .single();

  if (error) throw error;
  return toReport(data);
}

async function updateReport(id, reportData) {
  const sb = getClientOrThrow();
  const row = toDbReport({ ...reportData, id });
  const { data, error } = await sb
    .from('reports')
    .update(row)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toReport(data);
}

async function deleteReport(id) {
  const sb = getClientOrThrow();
  const { error } = await sb
    .from('reports')
    .delete()
    .eq('id', id);

  if (error) throw error;
  return true;
}

async function updateReportDriveUrls(id, pdfDriveUrl, pdfDriveDownloadUrl) {
  const sb = getClientOrThrow();
  const { data, error } = await sb
    .from('reports')
    .update({
      pdf_drive_url: pdfDriveUrl,
      pdf_drive_download_url: pdfDriveDownloadUrl,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toReport(data);
}

// ----------------------------------------------------------------------------
// NUMERACIÓN ATÓMICA DE REPORTES MEDIANTE FUNCIÓN POSTGRESQL
// ----------------------------------------------------------------------------

async function getNextReportNumber(peekOnly = false) {
  const sb = getClientOrThrow();
  const { data, error } = await sb.rpc('generate_next_report_number', {
    peek_only: Boolean(peekOnly)
  });

  if (error) {
    console.error('[Supabase RPC] Error al generar correlativo:', error.message);
    throw error;
  }
  return data;
}

// ----------------------------------------------------------------------------
// PLANES DE MANTENIMIENTO Y TAREAS
// ----------------------------------------------------------------------------

async function getMaintenancePlans() {
  const sb = getClientOrThrow();
  const { data, error } = await sb
    .from('maintenance_plans')
    .select('*')
    .eq('id', 'default_plans')
    .single();

  if (error && error.code !== 'PGRST116') throw error;

  if (!data) {
    return { allTasks: [], defaultPlans: {}, customModelPlans: {} };
  }

  return {
    allTasks: Array.isArray(data.all_tasks) ? data.all_tasks : [],
    defaultPlans: data.default_plans || {},
    customModelPlans: data.custom_model_plans || {}
  };
}

async function updateMaintenancePlans(plansData) {
  const sb = getClientOrThrow();
  const row = {
    id: 'default_plans',
    all_tasks: plansData.allTasks || [],
    default_plans: plansData.defaultPlans || {},
    custom_model_plans: plansData.customModelPlans || {},
    updated_at: new Date().toISOString()
  };

  const { data, error } = await sb
    .from('maintenance_plans')
    .upsert(row)
    .select()
    .single();

  if (error) throw error;
  return {
    allTasks: data.all_tasks,
    defaultPlans: data.default_plans,
    customModelPlans: data.custom_model_plans
  };
}

// ----------------------------------------------------------------------------
// PRUEBA DE CONEXIÓN
// ----------------------------------------------------------------------------

async function testConnection() {
  try {
    const sb = getClientOrThrow();
    const { data, error } = await sb.from('report_counters').select('*').limit(1);
    if (error) return { ok: false, error: error.message };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  get supabase() { return getSupabase(); },
  getSupabase,
  testConnection,
  getClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
  getEquipments,
  getEquipmentById,
  createEquipment,
  updateEquipment,
  deleteEquipment,
  addEquipmentReading,
  deleteEquipmentReading,
  getReports,
  getReportById,
  createReport,
  updateReport,
  deleteReport,
  updateReportDriveUrls,
  getNextReportNumber,
  getMaintenancePlans,
  updateMaintenancePlans
};
