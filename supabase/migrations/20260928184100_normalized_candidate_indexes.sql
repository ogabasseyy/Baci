-- disable-transaction
-- Normalize the candidate-selection partial indexes for the Paystack
-- reconciliation workers. Legacy rows may pad or re-case gateway
-- values (` Paystack `) while cancellation still treats them as live
-- captures, so the candidate RPCs match on
-- normalized_gateway_name_v1(gateway) = 'PAYSTACK' — and PostgreSQL
-- can only use a partial index when the query implies its predicate,
-- which the old `gateway = 'paystack'` predicates no longer satisfy.
-- Replace the three worker indexes with normalized-predicate
-- equivalents (same key columns, same remaining predicates) and drop
-- the old ones: the abandoned-attempt sweep, the pending-refund
-- worker, and the completed-refund worker are the only readers.
-- Keys order NULLS FIRST to match the candidate RPCs: null
-- timestamps are the oldest eligible rows and must sort ahead of
-- the bounded limit. Build concurrently to avoid blocking live
-- transaction writes.

DROP INDEX CONCURRENTLY IF EXISTS
  paystack_abandoned_attempt_candidates_idx;
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  paystack_abandoned_attempt_candidates_normalized_idx
  ON public.transactions (updated_at ASC NULLS FIRST, id)
  WHERE transaction_type = 'payment'
    AND public.normalized_gateway_name_v1(gateway) = 'PAYSTACK'
    AND status IN ('pending', 'processing')
    AND order_id IS NOT NULL
    AND gateway_reference IS NOT NULL
    -- Mirror the worker query: stamped rows already reached a terminal
    -- outcome, so excluding them keeps the oldest-first lookup from
    -- scanning the entire reviewed history.
    AND metadata->'abandoned_sweep_resolution' IS NULL;

DROP INDEX CONCURRENTLY IF EXISTS
  paystack_pending_cancellation_refunds_idx;
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  paystack_pending_cancellation_refunds_normalized_idx
  ON public.transactions (updated_at ASC NULLS FIRST, id)
  WHERE transaction_type = 'refund'
    AND public.normalized_gateway_name_v1(gateway) = 'PAYSTACK'
    AND status IN ('refund_pending', 'pending')
    AND (metadata->>'refund_reconciliation_hold') IS NULL;

DROP INDEX CONCURRENTLY IF EXISTS
  paystack_completed_cancellation_refund_recheck_idx;
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  paystack_completed_cancellation_refund_recheck_normalized_idx
  ON public.transactions (updated_at ASC NULLS FIRST, id)
  WHERE transaction_type = 'refund'
    AND public.normalized_gateway_name_v1(gateway) = 'PAYSTACK'
    AND status = 'completed';
