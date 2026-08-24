-- Supabase policy fix for task_assignments
-- Ejecuta esto en el SQL editor de Supabase para que la tabla acepte inserts desde el cliente anónimo.

ALTER TABLE public.task_assignments ENABLE ROW LEVEL SECURITY;

-- Permitir lectura pública desde el cliente anónimo
DROP POLICY IF EXISTS "anon_select_task_assignments" ON public.task_assignments;
CREATE POLICY "anon_select_task_assignments" ON public.task_assignments
  FOR SELECT TO anon USING (true);

-- Permitir inserciones desde el cliente anónimo
DROP POLICY IF EXISTS "anon_insert_task_assignments" ON public.task_assignments;
CREATE POLICY "anon_insert_task_assignments" ON public.task_assignments
  FOR INSERT TO anon WITH CHECK (true);

-- Permitir actualizaciones desde el cliente anónimo
DROP POLICY IF EXISTS "anon_update_task_assignments" ON public.task_assignments;
CREATE POLICY "anon_update_task_assignments" ON public.task_assignments
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- Permitir eliminaciones desde el cliente anónimo
DROP POLICY IF EXISTS "anon_delete_task_assignments" ON public.task_assignments;
CREATE POLICY "anon_delete_task_assignments" ON public.task_assignments
  FOR DELETE TO anon USING (true);

-- Políticas para usuarios autenticados
DROP POLICY IF EXISTS "authenticated_select_task_assignments" ON public.task_assignments;
CREATE POLICY "authenticated_select_task_assignments" ON public.task_assignments
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_insert_task_assignments" ON public.task_assignments;
CREATE POLICY "authenticated_insert_task_assignments" ON public.task_assignments
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_update_task_assignments" ON public.task_assignments;
CREATE POLICY "authenticated_update_task_assignments" ON public.task_assignments
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_delete_task_assignments" ON public.task_assignments;
CREATE POLICY "authenticated_delete_task_assignments" ON public.task_assignments
  FOR DELETE TO authenticated USING (true);
