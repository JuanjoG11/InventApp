-- Supabase setup SQL
-- 1) Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2) Tabla de productos
CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text,
  name text NOT NULL,
  code text,
  embalaje integer DEFAULT 1,
  expected_stock integer DEFAULT 0,
  precio numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Asegurar un índice único en 'code' para que ON CONFLICT (code) funcione
CREATE UNIQUE INDEX IF NOT EXISTS products_code_idx ON public.products (code);

-- 3) Tabla de historial de inventarios
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

-- 4) Tabla profiles (metadatos de usuarios)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  email text,
  full_name text,
  role text DEFAULT 'worker',
  created_at timestamptz DEFAULT now()
);

-- 5) Tabla de tareas asignadas en tiempo real para sincronizar admin -> trabajador
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

CREATE POLICY "public_select_task_assignments" ON public.task_assignments
  FOR SELECT
  USING (true);

CREATE POLICY "public_insert_task_assignments" ON public.task_assignments
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "public_update_task_assignments" ON public.task_assignments
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- 6) Datos de ejemplo para products (puedes añadir más filas)
INSERT INTO public.products (provider, name, code, embalaje, expected_stock, precio)
VALUES
('fleischmann', 'Levadura Fleischmann Fresca 500 G', '90940000', 50, 9146, 4800),
('fleischmann', 'Esencia Fleischmann Banano 500 ML', '90940003', 24, 15, 12000),
('alpina', 'Leche Alpina Entera 1L', 'ALP-101', 12, 200, 5200),
('alpina', 'Mantequilla Alpina 250g', 'ALP-102', 10, 50, 8200),
('zenu', 'Salchicha Zenu 1kg', 'ZEN-201', 6, 120, 14500),
('unilever', 'Shampoo Dove 400ml', 'UNI-401', 8, 60, 18500),
('familia', 'Papel Higiénico Familia 4x', 'FAM-501', 4, 80, 9400),
('bimbo', 'Pan Bimbo Familiar 600g', 'BIM-601', 10, 40, 7600),
('colgate', 'Pasta Colgate 90g', 'COL-701', 20, 300, 6400),
('nestle', 'Nesquik 400g', 'NES-801', 6, 70, 15800)
ON CONFLICT (code) DO NOTHING;

-- 6) Examples: crear perfiles (si ya creaste usuarios en Auth, actualiza `id` con su uid)
-- Reemplaza los UUIDs por los uid reales de Supabase Auth si existen
INSERT INTO public.profiles (id, email, full_name, role)
VALUES
(gen_random_uuid(), 'anyi.mosquera@dechss.com', 'Anyi Mosquera', 'admin'),
(gen_random_uuid(), 'quebin.lotero@dechss.com', 'Quebin Lotero', 'worker')
ON CONFLICT (id) DO NOTHING;

-- 7) Políticas RLS mínimas (activar RLS y políticas ejemplo)
-- Activar RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Productos: permitir lectura pública (anon) para que la app pueda listar catálogo
CREATE POLICY "public_select_products" ON public.products
  FOR SELECT
  USING (true);

-- Historial: permitir inserts anónimos y públicos para el historial de conteos
CREATE POLICY "public_insert_history" ON public.inventory_history
  FOR INSERT
  WITH CHECK (true);

-- Profiles: permitir select del propio perfil
CREATE POLICY "select_own_profile" ON public.profiles
  FOR SELECT
  USING (auth.uid()::uuid = id OR auth.role() = 'authenticated');

-- Nota: Ajusta las políticas según tu modelo de seguridad; las anteriores son ejemplos mínimos.

-- 8) Ejemplo: vaciado y recarga rápida de productos (útil en pruebas)
-- TRUNCATE TABLE public.products RESTART IDENTITY;
-- COPY public.products(provider,name,code,embalaje,expected_stock,precio) FROM '/path/to/file.csv' DELIMITER ',' CSV HEADER;

-- Fin del script
