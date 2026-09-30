-- ============================================================
--  InventApp — Migración para Sistema de Bloques
--  Ejecuta este SQL en el editor de Supabase (SQL Editor)
-- ============================================================

-- 1) Agregar columna block_num a worker_counts
--    (número de bloque del auxiliar, 0 = worker con cuenta normal)
ALTER TABLE public.worker_counts
  ADD COLUMN IF NOT EXISTS block_num integer DEFAULT 0;

-- 2) Agregar columna worker_name a worker_counts
--    (nombre legible del auxiliar, sin necesidad de account)
ALTER TABLE public.worker_counts
  ADD COLUMN IF NOT EXISTS worker_name text;

-- 3) Agregar columna numBlocks a task_assignments
--    (cuántos bloques tiene el lote publicado)
ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS "numBlocks" integer DEFAULT 0;

-- 4) Agregar columna blocks a task_assignments
--    (estructura completa de bloques: { "1": [...items], "2": [...items] })
ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS blocks jsonb;

-- 5) Índice para filtrar rápido por bloque
CREATE INDEX IF NOT EXISTS idx_worker_counts_block_num
  ON public.worker_counts (block_num);

-- 6) Habilitar Realtime en las tablas (si no está habilitado)
--    Ve a Supabase → Table Editor → selecciona la tabla → Replication → Enable Realtime
--    O ejecuta:
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.worker_counts;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.task_assignments;

-- Nota: Las políticas RLS existentes ya cubren las nuevas columnas.
-- No necesitas agregar políticas adicionales.
