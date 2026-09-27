BEGIN;

-- Production orders rows already carry paid_at (the storefront
-- order-tracking RPC has projected o.paid_at since April 2026 and the
-- live order-tracking route reads it on every lookup), but no repo
-- migration ever recorded the column. Any database built purely from
-- repo migrations (history replay, fresh environments, preview
-- branches) is therefore missing it, and get_order_tracking fails
-- there with undefined_column on first call. Record the column so
-- migrated databases match production. No backfill: existing rows
-- keep NULL until a payment marks them paid.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

COMMIT;
