-- disable-transaction
-- Exclude stamped attempts from the abandoned-candidate index. The
-- worker query filters out rows carrying
-- metadata->abandoned_sweep_resolution, but the partial index
-- includes every pending or processing Paystack row — and review
-- paths deliberately leave stamped transactions in those statuses.
-- As reviewed attempts accumulate, the oldest-first lookup scans and
-- discards the entire stamped history before finding its eligible
-- rows. Rebuild concurrently to avoid blocking live writes; the
-- predicate mirrors the query's resolution filter exactly so the
-- planner keeps using the index.
DROP INDEX CONCURRENTLY IF EXISTS
  public.paystack_abandoned_attempt_candidates_idx;

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  paystack_abandoned_attempt_candidates_idx
  ON public.transactions (updated_at, id)
  WHERE transaction_type = 'payment'
    AND gateway = 'paystack'
    AND status IN ('pending', 'processing')
    AND order_id IS NOT NULL
    AND gateway_reference IS NOT NULL
    AND metadata->'abandoned_sweep_resolution' IS NULL;
