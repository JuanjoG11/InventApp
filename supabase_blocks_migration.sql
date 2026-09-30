-- ============================================================
--  InventApp — Migración para Sistema de Bloques
--  Ejecuta este SQL en el editor de Supabase (SQL Editor)
-- ============================================================

-- 1) Agregar columna block_num a worker_counts
ALTER TABLE public.worker_counts
  ADD COLUMN IF NOT EXISTS block_num integer DEFAULT 0;

-- 2) Agregar columna worker_name a worker_counts
ALTER TABLE public.worker_counts
  ADD COLUMN IF NOT EXISTS worker_name text;

-- 3) Agregar columna numBlocks a task_assignments
ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS "numBlocks" integer DEFAULT 0;

-- 4) Agregar columna blocks a task_assignments
ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS blocks jsonb;

-- 5) Agregar columna precio a inventory_history (faltaba en instalaciones previas)
ALTER TABLE public.inventory_history
  ADD COLUMN IF NOT EXISTS precio numeric DEFAULT 0;

-- 6) Índice para filtrar rápido por bloque
CREATE INDEX IF NOT EXISTS idx_worker_counts_block_num
  ON public.worker_counts (block_num);

-- 7) Habilitar Realtime en las tablas (si no está habilitado)
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.worker_counts;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.task_assignments;
