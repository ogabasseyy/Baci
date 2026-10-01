-- disable-transaction
-- Build the audit foreign-key indexes without blocking writes before the
-- additive 20260811130000 migration runs its IF NOT EXISTS statements.
-- This migration is intentionally ordered immediately before that migration;
-- both are new in this PR and have not been deployed independently.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expenses_created_by_user_id
  ON public.expenses (created_by_user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expenses_updated_by_user_id
  ON public.expenses (updated_by_user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expenses_group_id
  ON public.expenses (group_id);
