-- disable-transaction
-- Cover the two bounded worker lookups the normalized-candidate pass
-- left without a serving index. The missing-reference branch of the
-- abandoned-attempt candidate RPC filters gateway_reference IS NULL,
-- which the normalized candidate index (requiring IS NOT NULL) can
-- never serve — so the hourly five-row trickle scans and sorts the
-- whole ledger. Mirror that index with the nullness flipped (same
-- keys, same remaining predicates). Likewise the recovery-watch
-- sweep orders open watches by updated_at — the touch column its
-- rotation bumps — while the table only carries a
-- (status, created_at) sweep index; a partial updated_at index for
-- open watches serves the bounded oldest-first batch without
-- disturbing the created_at retirement gate. Build concurrently to
-- avoid blocking live transaction writes.

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  paystack_abandoned_missing_ref_candidates_idx
  ON public.transactions (updated_at ASC NULLS FIRST, id)
  WHERE transaction_type = 'payment'
    AND public.normalized_gateway_name_v1(gateway) = 'PAYSTACK'
    AND status IN ('pending', 'processing')
    AND order_id IS NOT NULL
    AND gateway_reference IS NULL
    AND metadata->'abandoned_sweep_resolution' IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  paystack_refund_recovery_watch_open_updated_idx
  ON public.paystack_refund_recovery_watch (updated_at ASC)
  WHERE status = 'open';
