-- disable-transaction
-- Bound the provider-verified legacy backfill by the oldest completed refund.
CREATE INDEX CONCURRENTLY IF NOT EXISTS paystack_completed_cancellation_refund_recheck_idx
  ON public.transactions (updated_at, id)
  WHERE transaction_type = 'refund'
    AND gateway = 'paystack'
    AND status = 'completed'
    AND (metadata->>'payment_transaction_id') IS NOT NULL;
