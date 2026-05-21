-- Supabase setup mínimo para InventApp cuando no usas auth.
-- Solo crea las tablas necesarias para sincronizar tareas y guardar historial.

-- 1) Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2) Tabla de tareas asignadas (admin -> trabajador)
CREATE TABLE IF NOT EXISTS public.task_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  published_by uuid,
  published_by_email text,
  status text DEFAULT 'active',
  payload jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.task_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_select_task_assignments" ON public.task_assignments;
CREATE POLICY "public_select_task_assignments" ON public.task_assignments
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "anon_insert_task_assignments" ON public.task_assignments;
CREATE POLICY "anon_insert_task_assignments" ON public.task_assignments
  FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "anonymous_update_task_assignments" ON public.task_assignments;
CREATE POLICY "anonymous_update_task_assignments" ON public.task_assignments
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- 3) Tabla de conteos en tiempo real del worker
CREATE TABLE IF NOT EXISTS public.worker_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id text NOT NULL,
  worker_email text NOT NULL,
  cajas integer DEFAULT 0,
  unidades integer DEFAULT 0,
  averias integer DEFAULT 0,
  item jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.worker_counts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_select_worker_counts" ON public.worker_counts;
CREATE POLICY "public_select_worker_counts" ON public.worker_counts
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "anon_insert_worker_counts" ON public.worker_counts;
CREATE POLICY "anon_insert_worker_counts" ON public.worker_counts
  FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_worker_counts" ON public.worker_counts;
CREATE POLICY "anon_update_worker_counts" ON public.worker_counts
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- 4) Tabla de historial de inventario
CREATE TABLE IF NOT EXISTS public.inventory_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  product_name text NOT NULL,
  product_code text,
  provider text,
  embalaje integer DEFAULT 1,
  expected_stock integer DEFAULT 0,
  precio numeric DEFAULT 0,
  cajas integer DEFAULT 0,
  unidades integer DEFAULT 0,
  total_contado integer DEFAULT 0,
  diff_uds integer DEFAULT 0,
  diff_valor_raw numeric DEFAULT 0,
  descuadre_formateado text,
  averias integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.inventory_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_insert_history" ON public.inventory_history;
CREATE POLICY "public_insert_history" ON public.inventory_history
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Nota:
--  * Si el admin sube todo desde Excel y no usas auth, no necesitas nada más.
--  * Las tablas task_assignments, worker_counts e inventory_history son suficientes.
--  * Mantén USE_SUPABASE_AUTH = false en app.js.
--  * Usa HTTPS y el URL/anon key correctos de Supabase.

