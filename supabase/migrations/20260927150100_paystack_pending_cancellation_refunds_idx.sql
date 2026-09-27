-- disable-transaction
-- The transactions table is live; build the worker's partial index without
-- holding a write-blocking index-build lock.
CREATE INDEX CONCURRENTLY IF NOT EXISTS paystack_pending_cancellation_refunds_idx
  ON public.transactions (updated_at, id)
  WHERE transaction_type = 'refund' AND gateway = 'paystack'
    AND status IN ('refund_pending', 'pending')
    AND (metadata->>'payment_transaction_id') IS NOT NULL
    AND (metadata->>'refund_reconciliation_hold') IS NULL;
