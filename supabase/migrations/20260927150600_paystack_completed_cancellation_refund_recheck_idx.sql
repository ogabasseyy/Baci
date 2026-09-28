-- disable-transaction
-- Bound the provider-verified legacy backfill by the oldest completed refund.
-- No payment-link predicate: the recheck deliberately includes legacy refunds
-- whose metadata lacks payment_transaction_id, and PostgreSQL can only use a
-- partial index when the query implies its predicate.
CREATE INDEX CONCURRENTLY IF NOT EXISTS paystack_completed_cancellation_refund_recheck_idx
  ON public.transactions (updated_at, id)
  WHERE transaction_type = 'refund'
    AND gateway = 'paystack'
    AND status = 'completed';
