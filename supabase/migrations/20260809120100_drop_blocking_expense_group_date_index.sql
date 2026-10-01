-- Hand off group-date indexing to the later concurrent rebuild migration.
DROP INDEX IF EXISTS public.idx_expenses_merchant_group_date;
