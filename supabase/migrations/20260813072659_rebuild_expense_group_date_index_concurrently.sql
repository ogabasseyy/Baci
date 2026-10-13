-- disable-transaction

-- Rebuild the historical index without holding a write-conflicting build lock.
DROP INDEX CONCURRENTLY IF EXISTS public.idx_expenses_merchant_group_date_next;
CREATE INDEX CONCURRENTLY idx_expenses_merchant_group_date_next
  ON public.expenses (merchant_id, group_id, date DESC);
DROP INDEX CONCURRENTLY IF EXISTS public.idx_expenses_merchant_group_date;
ALTER INDEX public.idx_expenses_merchant_group_date_next
  RENAME TO idx_expenses_merchant_group_date;
