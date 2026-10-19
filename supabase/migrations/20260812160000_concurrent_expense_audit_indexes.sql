-- disable-transaction

-- Keep creation non-blocking when these indexes are first introduced. The
-- preceding migration remains append-only; IF NOT EXISTS makes this safe when
-- it has already created the indexes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expenses_created_by_user_id
  ON public.expenses (created_by_user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expenses_updated_by_user_id
  ON public.expenses (updated_by_user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expenses_group_id
  ON public.expenses (group_id);
