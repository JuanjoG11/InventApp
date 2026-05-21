-- Supabase policy fix for task_assignments
-- Ejecuta esto en el SQL editor de Supabase para que la tabla acepte inserts desde el cliente anónimo.

ALTER TABLE public.task_assignments ENABLE ROW LEVEL SECURITY;

-- Permitir lectura pública desde el cliente anónimo
CREATE POLICY IF NOT EXISTS "anon_select_task_assignments" ON public.task_assignments
  FOR SELECT
  TO anon
  USING (true);

-- Permitir inserciones desde el cliente anónimo
CREATE POLICY IF NOT EXISTS "anon_insert_task_assignments" ON public.task_assignments
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Permitir actualizaciones desde el cliente anónimo
CREATE POLICY IF NOT EXISTS "anon_update_task_assignments" ON public.task_assignments
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- También permitir inserciones/lecturas para usuarios autenticados si después usas auth en la app
CREATE POLICY IF NOT EXISTS "authenticated_select_task_assignments" ON public.task_assignments
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY IF NOT EXISTS "authenticated_insert_task_assignments" ON public.task_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "authenticated_update_task_assignments" ON public.task_assignments
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Permitir eliminaciones desde el cliente anónimo
CREATE POLICY IF NOT EXISTS "anon_delete_task_assignments" ON public.task_assignments
  FOR DELETE
  TO anon
  USING (true);

-- Permitir eliminaciones para usuarios autenticados
CREATE POLICY IF NOT EXISTS "authenticated_delete_task_assignments" ON public.task_assignments
  FOR DELETE
  TO authenticated
  USING (true);

