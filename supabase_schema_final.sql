-- ============================================================================
-- INDUSTRAC S.A.C. — SISTEMA DE REPORTES TÉCNICOS
-- ARCHIVO DEFINITIVO DE ESQUEMA POSTGRESQL PARA SUPABASE
-- Archivo: supabase_schema_final.sql
-- Compatible con: Node.js Express, Vercel Serverless y Google Drive
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ELIMINACIÓN PREVIA EN ORDEN ESTRICTO DE DEPENDENCIAS (SIN CASCADE)
-- ----------------------------------------------------------------------------
-- Funciones primero:
DROP FUNCTION IF EXISTS public.generate_next_report_number(BOOLEAN);

-- Tablas dependientes después (hijas primero, luego maestras):
DROP TABLE IF EXISTS public.maintenance_schedules;
DROP TABLE IF EXISTS public.hourmeter_readings;
DROP TABLE IF EXISTS public.reports;
DROP TABLE IF EXISTS public.equipments;
DROP TABLE IF EXISTS public.clients;
DROP TABLE IF EXISTS public.maintenance_plans;
DROP TABLE IF EXISTS public.report_counters;


-- ----------------------------------------------------------------------------
-- 2. CREACIÓN DE LAS 7 TABLAS DEL SISTEMA INDUSTRAC (ESQUEMA PUBLIC EXPLÍCITO)
-- ----------------------------------------------------------------------------

-- 1. Tabla: public.clients (Clientes de INDUSTRAC S.A.C.)
CREATE TABLE public.clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT DEFAULT '',
    contact TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    is_demo BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabla: public.equipments (Compresores y equipos industriales)
CREATE TABLE public.equipments (
    id TEXT PRIMARY KEY,
    client_id TEXT REFERENCES public.clients(id) ON DELETE SET NULL,
    client TEXT NOT NULL,
    address TEXT DEFAULT '',
    manufacturer TEXT DEFAULT '',
    model TEXT NOT NULL,
    serial_number TEXT DEFAULT '',
    api_code TEXT DEFAULT '',
    controller TEXT DEFAULT '',
    pressure TEXT DEFAULT '',
    airflow TEXT DEFAULT '',
    oil_type TEXT DEFAULT '',
    hour_meter NUMERIC DEFAULT 0,
    hours NUMERIC DEFAULT 0,
    maintenance_cycle TEXT DEFAULT 'ciclo_2000',
    cycle_type TEXT DEFAULT 'ciclo_2000',
    alert_threshold_hours NUMERIC DEFAULT 200,
    monthly_average_hours NUMERIC,
    location TEXT DEFAULT '',
    status TEXT DEFAULT 'Activo',
    active BOOLEAN DEFAULT TRUE,
    notes TEXT DEFAULT '',
    is_demo BOOLEAN DEFAULT FALSE,
    last_maintenance JSONB,
    next_maintenance JSONB,
    readings_history JSONB DEFAULT '[]'::jsonb,
    last_reading_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabla: public.reports (Reportes técnicos oficiales)
CREATE TABLE public.reports (
    id TEXT PRIMARY KEY,
    report_number TEXT UNIQUE NOT NULL,
    date DATE NOT NULL,
    client TEXT NOT NULL,
    equipment_id TEXT REFERENCES public.equipments(id) ON DELETE SET NULL,
    api_code TEXT DEFAULT '',
    address TEXT DEFAULT '',
    technician TEXT DEFAULT '',
    service_type TEXT DEFAULT 'Mantenimiento',
    maintenance_type TEXT DEFAULT '',
    model TEXT DEFAULT '',
    serial_number TEXT DEFAULT '',
    controller TEXT DEFAULT '',
    pressure TEXT DEFAULT '',
    airflow TEXT DEFAULT '',
    hour_meter NUMERIC DEFAULT 0,
    oil_type TEXT DEFAULT '',
    oil_quantities JSONB DEFAULT '{}'::jsonb,
    oil_level TEXT DEFAULT '',
    custom_oil TEXT DEFAULT '',
    manufacturer TEXT DEFAULT '',
    mechanical_tasks JSONB DEFAULT '{}'::jsonb,
    other_mechanical_tasks TEXT DEFAULT '',
    pending_tasks_reason TEXT DEFAULT '',
    has_electrical BOOLEAN DEFAULT FALSE,
    electrical JSONB DEFAULT '{}'::jsonb,
    main_motor JSONB DEFAULT '{}'::jsonb,
    fan_motor JSONB DEFAULT '{}'::jsonb,
    has_dryer BOOLEAN DEFAULT FALSE,
    dryer JSONB DEFAULT '{}'::jsonb,
    service_lives JSONB DEFAULT '{}'::jsonb,
    regulations JSONB DEFAULT '{}'::jsonb,
    technical_parameters JSONB DEFAULT '{}'::jsonb,
    observations TEXT DEFAULT '',
    recommendations TEXT DEFAULT '',
    photos JSONB DEFAULT '[]'::jsonb,
    tech_signature TEXT DEFAULT '',
    tech_name TEXT DEFAULT '',
    client_signature TEXT DEFAULT '',
    client_signer_name TEXT DEFAULT '',
    client_signer_position TEXT DEFAULT '',
    status TEXT DEFAULT 'Finalizado',
    draft_saved_on DATE,
    pdf_drive_url TEXT DEFAULT '',
    pdf_drive_download_url TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabla: public.report_counters (Controlador atómico de correlativos)
CREATE TABLE public.report_counters (
    prefix TEXT NOT NULL,
    year INTEGER NOT NULL,
    last_sequence INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (prefix, year)
);

-- 5. Tabla: public.maintenance_plans (Catálogo de planes y tareas)
CREATE TABLE public.maintenance_plans (
    id TEXT PRIMARY KEY,
    all_tasks JSONB DEFAULT '[]'::jsonb,
    default_plans JSONB DEFAULT '{}'::jsonb,
    custom_model_plans JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Tabla: public.hourmeter_readings (Histórico de horómetros por equipo)
CREATE TABLE public.hourmeter_readings (
    id TEXT PRIMARY KEY,
    equipment_id TEXT NOT NULL REFERENCES public.equipments(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    hour_meter NUMERIC NOT NULL,
    hours NUMERIC NOT NULL,
    type TEXT DEFAULT 'mantenimiento',
    plan TEXT DEFAULT '',
    report_number TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    user_name TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Tabla: public.maintenance_schedules (Cronograma proyectado de servicios)
CREATE TABLE public.maintenance_schedules (
    id TEXT PRIMARY KEY,
    equipment_id TEXT NOT NULL REFERENCES public.equipments(id) ON DELETE CASCADE,
    cycle_type TEXT DEFAULT 'ciclo_2000',
    current_hours NUMERIC DEFAULT 0,
    milestone_hours NUMERIC NOT NULL,
    plan_name TEXT NOT NULL,
    estimated_date DATE,
    status TEXT DEFAULT 'Pendiente',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ----------------------------------------------------------------------------
-- 3. ÍNDICES DE RENDIMIENTO Y OPTIMIZACIÓN DE CONSULTAS
-- ----------------------------------------------------------------------------
CREATE INDEX idx_equipments_client_id ON public.equipments(client_id);
CREATE INDEX idx_equipments_api_code ON public.equipments(api_code);
CREATE INDEX idx_reports_equipment_id ON public.reports(equipment_id);
CREATE INDEX idx_reports_report_number ON public.reports(report_number);
CREATE INDEX idx_reports_date ON public.reports(date DESC);
CREATE INDEX idx_reports_status ON public.reports(status);
CREATE INDEX idx_readings_equipment_id ON public.hourmeter_readings(equipment_id);
CREATE INDEX idx_schedules_equipment_id ON public.maintenance_schedules(equipment_id);


-- ----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS) ACTIVADO EN TODAS LAS TABLAS
-- ----------------------------------------------------------------------------
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hourmeter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_schedules ENABLE ROW LEVEL SECURITY;


-- ----------------------------------------------------------------------------
-- 5. FUNCIÓN POSTGRESQL ATÓMICA CON SECURITY DEFINER SEGURO
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_next_report_number(peek_only BOOLEAN DEFAULT FALSE)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prefix TEXT := 'REP';
    v_year INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
    v_seq INTEGER;
    v_report_number TEXT;
BEGIN
    -- Asegurar de forma atómica e idempotente la existencia del registro para el año actual
    INSERT INTO public.report_counters (prefix, year, last_sequence, updated_at)
    VALUES (v_prefix, v_year, 0, NOW())
    ON CONFLICT (prefix, year) DO NOTHING;

    IF peek_only THEN
        -- Consulta de previsualización sin consumir el correlativo
        SELECT last_sequence + 1 INTO v_seq
        FROM public.report_counters
        WHERE prefix = v_prefix AND year = v_year;
    ELSE
        -- Incremento atómico bloqueante con protección contra concurrencia multiusuario
        UPDATE public.report_counters
        SET last_sequence = last_sequence + 1,
            updated_at = NOW()
        WHERE prefix = v_prefix AND year = v_year
        RETURNING last_sequence INTO v_seq;
    END IF;

    -- Formato estándar oficial: REP-AAAA-0001
    v_report_number := v_prefix || '-' || v_year::TEXT || '-' || LPAD(v_seq::TEXT, 4, '0');
    RETURN v_report_number;
END;
$$;

-- Restricción estricta de permisos sobre la función:
REVOKE ALL ON FUNCTION public.generate_next_report_number(BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_next_report_number(BOOLEAN) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_next_report_number(BOOLEAN) TO service_role;


-- ----------------------------------------------------------------------------
-- 6. DATOS INICIALES SEMILLA (CATÁLOGO ORIGINAL INDUSTRAC S.A.C.)
-- ----------------------------------------------------------------------------
INSERT INTO public.report_counters (prefix, year, last_sequence, updated_at)
VALUES ('REP', EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER, 0, NOW())
ON CONFLICT (prefix, year) DO NOTHING;

INSERT INTO public.maintenance_plans (id, all_tasks, default_plans, custom_model_plans, updated_at)
VALUES (
    'default_plans',
    '[
        {"id": "filtro_aceite", "name": "1 Filtro de Aceite", "category": "Filtros"},
        {"id": "filtro_aire", "name": "1 Filtro de Aire", "category": "Filtros"},
        {"id": "filtro_separador", "name": "1 Filtro Separador", "category": "Filtros"},
        {"id": "cambio_aceite", "name": "Aceite Roto Xtend (5 L / 20 L)", "category": "Lubricación"},
        {"id": "valvula_termostatica", "name": "Kit de válvula termostática", "category": "Válvulas"},
        {"id": "valvula_minima_presion", "name": "Kit de válvula de mínima presión", "category": "Válvulas"},
        {"id": "kits_drenaje_ld20", "name": "Kits de drenaje LD20", "category": "Drenajes"},
        {"id": "valvula_admision", "name": "Mantenimiento de válvula de admisión", "category": "Válvulas"},
        {"id": "valvula_check", "name": "Mantenimiento de válvula check", "category": "Válvulas"},
        {"id": "valvula_oilstop", "name": "Mantenimiento de válvula oilstop", "category": "Válvulas"},
        {"id": "trampa_agua", "name": "Mantenimiento de trampa de agua", "category": "Drenajes"},
        {"id": "check_barrido", "name": "Cambio de check de barrido", "category": "Líneas"},
        {"id": "limpieza_enfriador", "name": "Limpieza de enfriador", "category": "Refrigeración"},
        {"id": "lavado_quimico_enfriador", "name": "Lavado químico de enfriador", "category": "Refrigeración"},
        {"id": "ajuste_tablero", "name": "Ajuste de tablero eléctrico", "category": "Eléctrico"},
        {"id": "otros_trabajos", "name": "Otros trabajos", "category": "General"}
    ]'::jsonb,
    '{
        "Plan A — 2000 horas": {
            "name": "Plan A — 2000 horas",
            "hours": 2000,
            "group": "Grupo 1 (2.000 / 4.000 / 8.000 h)",
            "cycleType": "ciclo_2000",
            "description": "Mantenimiento preventivo de 2.000 horas: Reemplazo de filtros primarios de aceite y admisión.",
            "autoLoadItems": [
                "1 Filtro de Aceite",
                "1 Filtro de Aire"
            ],
            "suggestedTasks": [
                "filtro_aceite",
                "filtro_aire"
            ]
        },
        "Plan B — 4000 horas": {
            "name": "Plan B — 4000 horas",
            "hours": 4000,
            "group": "Grupo 1 (2.000 / 4.000 / 8.000 h)",
            "cycleType": "ciclo_2000",
            "description": "Mantenimiento intermedio de 4.000 horas: Filtración completa y cambio de lubricante sintético.",
            "oilType": "Roto Xtend (20 L)",
            "oilPresentations": ["5 L", "20 L"],
            "autoLoadItems": [
                "1 Filtro de Aceite",
                "1 Filtro de Aire",
                "1 Filtro Separador",
                "Aceite Roto Xtend, con presentaciones de 5 L y 20 L"
            ],
            "suggestedTasks": [
                "filtro_aceite",
                "filtro_aire",
                "filtro_separador",
                "cambio_aceite"
            ]
        },
        "Plan C — 8000 horas": {
            "name": "Plan C — 8000 horas",
            "hours": 8000,
            "group": "Grupo 1 (2.000 / 4.000 / 8.000 h)",
            "cycleType": "ciclo_2000",
            "description": "Mantenimiento integral mayor de 8.000 horas: Filtración total, lubricante y reemplazo preventivo de kits de válvulas y drenajes.",
            "oilType": "Roto Xtend (20 L)",
            "oilPresentations": ["5 L", "20 L"],
            "autoLoadItems": [
                "1 Filtro de Aceite",
                "1 Filtro de Aire",
                "1 Filtro Separador",
                "Aceite Roto Xtend, con presentaciones de 5 L y 20 L",
                "Kit de válvula termostática",
                "Kit de válvula de mínima presión",
                "Kits de drenaje LD20"
            ],
            "suggestedTasks": [
                "filtro_aceite",
                "filtro_aire",
                "filtro_separador",
                "cambio_aceite",
                "valvula_termostatica",
                "valvula_minima_presion",
                "kits_drenaje_ld20"
            ]
        },
        "Plan A — 3000 horas": {
            "name": "Plan A — 3000 horas",
            "hours": 3000,
            "group": "Grupo 2 (3.000 / 6.000 / 12.000 h)",
            "cycleType": "ciclo_3000",
            "description": "Mantenimiento preventivo de 3.000 horas: Reemplazo de filtros de aceite y admisión.",
            "autoLoadItems": [
                "1 Filtro de Aceite",
                "1 Filtro de Aire"
            ],
            "suggestedTasks": [
                "filtro_aceite",
                "filtro_aire"
            ]
        },
        "Plan B — 6000 horas": {
            "name": "Plan B — 6000 horas",
            "hours": 6000,
            "group": "Grupo 2 (3.000 / 6.000 / 12.000 h)",
            "cycleType": "ciclo_3000",
            "description": "Mantenimiento intermedio de 6.000 horas: Filtración completa y cambio de lubricante sintético.",
            "oilType": "Sigma 5GAL",
            "oilPresentations": ["1 GAL", "5 GAL"],
            "autoLoadItems": [
                "1 Filtro de Aceite",
                "1 Filtro de Aire",
                "1 Filtro Separador",
                "Aceite Sigma 5GAL"
            ],
            "suggestedTasks": [
                "filtro_aceite",
                "filtro_aire",
                "filtro_separador",
                "cambio_aceite"
            ]
        },
        "Plan C — 12000 horas": {
            "name": "Plan C — 12000 horas",
            "hours": 12000,
            "group": "Grupo 2 (3.000 / 6.000 / 12.000 h)",
            "cycleType": "ciclo_3000",
            "description": "Mantenimiento mayor de 12.000 horas: Filtración total, lubricante y reemplazo de kits de válvulas operativas y drenaje.",
            "oilType": "Sigma 5GAL",
            "oilPresentations": ["1 GAL", "5 GAL"],
            "autoLoadItems": [
                "1 Filtro de Aceite",
                "1 Filtro de Aire",
                "1 Filtro Separador",
                "Aceite Sigma 5GAL",
                "Kit de válvula termostática",
                "Kit de válvula de mínima presión",
                "Kits de drenaje LD20"
            ],
            "suggestedTasks": [
                "filtro_aceite",
                "filtro_aire",
                "filtro_separador",
                "cambio_aceite",
                "valvula_termostatica",
                "valvula_minima_presion",
                "kits_drenaje_ld20"
            ]
        }
    }'::jsonb,
    '{}'::jsonb,
    NOW()
)
ON CONFLICT (id) DO UPDATE 
SET all_tasks = EXCLUDED.all_tasks, 
    default_plans = EXCLUDED.default_plans,
    custom_model_plans = COALESCE(public.maintenance_plans.custom_model_plans, EXCLUDED.custom_model_plans, '{}'::jsonb),
    updated_at = NOW();
