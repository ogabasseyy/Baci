-- disable-transaction
-- Rebuild invalid concurrent audit indexes after a failed deployment attempt.

DROP INDEX CONCURRENTLY IF EXISTS public.idx_expenses_created_by_user_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_expenses_updated_by_user_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_expenses_group_id;

CREATE INDEX CONCURRENTLY idx_expenses_created_by_user_id
  ON public.expenses (created_by_user_id);

CREATE INDEX CONCURRENTLY idx_expenses_updated_by_user_id
  ON public.expenses (updated_by_user_id);

CREATE INDEX CONCURRENTLY idx_expenses_group_id
  ON public.expenses (group_id);
