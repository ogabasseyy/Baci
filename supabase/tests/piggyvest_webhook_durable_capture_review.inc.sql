-- Part of piggyvest_webhook_durable_capture.sql (\ir): closing a dead-lettered row.
-- Runs inside the entry file's transaction and session; not a standalone suite.

-- A dead-lettered (needs_review) row is closed by a successful inline retry
-- (no claim token, 'processed') and by no other tokenless transition, so a
-- resend that finally succeeds clears the review state without letting a
-- stale inline finisher revive or rewrite the row.
DO $$
DECLARE
  v_dead uuid;
  v_claim record;
  v_row record;
BEGIN
  DELETE FROM public.piggyvest_webhook_captures;
  v_dead := (public.capture_piggyvest_webhook_delivery(
    pg_temp.pv_cmd('\x7b2264223a317d'::bytea, 'evt-dead', 'bank-transfer.inflow.success', 'txn-dead')))->>'id';
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  IF NOT public.resolve_piggyvest_webhook_capture(v_dead, v_claim.claim_token, 'needs_review', 'PROCESSING_ATTEMPTS_EXHAUSTED') THEN
    RAISE EXCEPTION 'the lease holder must be able to dead-letter its row';
  END IF;
  IF public.resolve_piggyvest_webhook_capture(v_dead, NULL, 'pending', NULL) THEN
    RAISE EXCEPTION 'a tokenless pending release must not revive a needs_review row';
  END IF;
  IF EXISTS (SELECT 1 FROM public.claim_piggyvest_webhook_captures(10, 60, 0)) THEN
    RAISE EXCEPTION 'a needs_review row must stay unclaimable';
  END IF;
  BEGIN
    PERFORM public.resolve_piggyvest_webhook_capture(v_dead, NULL, 'needs_review', 'X');
    RAISE EXCEPTION 'a tokenless review state must be rejected';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  IF NOT public.resolve_piggyvest_webhook_capture(v_dead, NULL, 'processed', NULL) THEN
    RAISE EXCEPTION 'a successful inline retry must close a dead-lettered row';
  END IF;
  SELECT * INTO v_row FROM public.piggyvest_webhook_captures WHERE id = v_dead;
  IF v_row.processing_state IS DISTINCT FROM 'processed'
    OR v_row.processed_at IS NULL OR v_row.last_error IS NOT NULL
    OR v_row.claim_token IS NOT NULL OR v_row.lease_until IS NOT NULL THEN
    RAISE EXCEPTION 'the closed row must be clean and processed: %', v_row;
  END IF;
  IF public.resolve_piggyvest_webhook_capture(v_dead, NULL, 'processed', NULL) THEN
    RAISE EXCEPTION 'a processed row must not be completed again';
  END IF;
END
$$;
