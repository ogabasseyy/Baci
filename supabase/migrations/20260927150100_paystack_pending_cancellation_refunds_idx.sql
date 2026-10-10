-- disable-transaction
-- The transactions table is live; build the worker's partial index without
-- holding a write-blocking index-build lock.
-- No payment-link predicate: the worker deliberately includes legacy refunds
-- whose metadata lacks payment_transaction_id, and PostgreSQL can only use a
-- partial index when the query implies its predicate.
CREATE INDEX CONCURRENTLY IF NOT EXISTS paystack_pending_cancellation_refunds_idx
  ON public.transactions (updated_at, id)
  WHERE transaction_type = 'refund' AND gateway = 'paystack'
    AND status IN ('refund_pending', 'pending')
    AND (metadata->>'refund_reconciliation_hold') IS NULL;
