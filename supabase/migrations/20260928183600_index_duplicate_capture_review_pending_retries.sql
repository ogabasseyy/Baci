-- disable-transaction
-- Keep duplicate-capture filing retries cheap as the ledger grows. The
-- retry marker lives on completed payments, which the abandoned-attempt
-- candidate index excludes, so both sweeps would scan completed history
-- on every invocation without this partial index. Build concurrently to
-- avoid blocking live transaction writes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS duplicate_capture_review_pending_candidates_idx
  ON public.transactions (updated_at, id)
  WHERE transaction_type = 'payment'
    AND status = 'completed'
    AND order_id IS NOT NULL
    AND metadata->>'duplicate_capture_review_pending' = 'true';
