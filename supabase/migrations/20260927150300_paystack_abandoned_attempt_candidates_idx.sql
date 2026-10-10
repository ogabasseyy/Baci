-- disable-transaction
-- Keep the oldest eligible Paystack payment attempts cheap to find as the
-- ledger grows. Build concurrently to avoid blocking live transaction writes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS paystack_abandoned_attempt_candidates_idx
  ON public.transactions (updated_at, id)
  WHERE transaction_type = 'payment'
    AND gateway = 'paystack'
    AND status IN ('pending', 'processing')
    AND order_id IS NOT NULL
    AND gateway_reference IS NOT NULL
    -- Mirror the worker query: stamped rows already reached a terminal
    -- outcome, so excluding them keeps the oldest-first lookup from
    -- scanning the entire reviewed history.
    AND metadata->'abandoned_sweep_resolution' IS NULL;
