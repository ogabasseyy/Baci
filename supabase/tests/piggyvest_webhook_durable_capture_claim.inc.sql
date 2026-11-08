-- Part of piggyvest_webhook_durable_capture.sql (\ir): claim/lease/resolve lifecycle, configuration deferral and fair claim order.
-- Runs inside the entry file's transaction and session; not a standalone suite.

DO $$
DECLARE
  v_id uuid;
  v_claim record;
  v_token uuid;
  v_status jsonb;
BEGIN
  DELETE FROM public.piggyvest_webhook_captures;
  v_id := (public.capture_piggyvest_webhook_delivery(
    pg_temp.pv_cmd('\x7b2261223a317d'::bytea, 'evt-claim', 'bank-transfer.inflow.success', 'txn-claim')))->>'id';

  IF EXISTS (SELECT 1 FROM public.claim_piggyvest_webhook_captures(10, 60, 300)) THEN
    RAISE EXCEPTION 'a fresh row must not be claimable before the inline grace period';
  END IF;

  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(10, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_id OR v_claim.attempts <> 1
    OR v_claim.raw_hex IS DISTINCT FROM '7b2261223a317d'
    OR v_claim.provider_transaction_id IS DISTINCT FROM 'txn-claim' THEN
    RAISE EXCEPTION 'claim must lease the row with its exact bytes: %', v_claim;
  END IF;
  v_token := v_claim.claim_token;

  IF EXISTS (SELECT 1 FROM public.claim_piggyvest_webhook_captures(10, 60, 0)) THEN
    RAISE EXCEPTION 'a leased row must not be claimed twice';
  END IF;
  IF public.resolve_piggyvest_webhook_capture(v_id, NULL, 'processed', NULL) THEN
    RAISE EXCEPTION 'inline completion must not overwrite a claimed row';
  END IF;
  IF public.resolve_piggyvest_webhook_capture(v_id, gen_random_uuid(), 'processed', NULL) THEN
    RAISE EXCEPTION 'a wrong claim token must not resolve the row';
  END IF;

  UPDATE public.piggyvest_webhook_captures
    SET lease_until = clock_timestamp() - interval '1 second' WHERE id = v_id;
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(10, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_id OR v_claim.attempts <> 2
    OR v_claim.claim_token = v_token THEN
    RAISE EXCEPTION 'an expired lease must be reclaimed with a fresh token';
  END IF;
  IF public.resolve_piggyvest_webhook_capture(v_id, v_token, 'processed', NULL) THEN
    RAISE EXCEPTION 'the previous lease holder must be fenced out';
  END IF;

  IF NOT public.resolve_piggyvest_webhook_capture(v_id, v_claim.claim_token, 'processed', NULL) THEN
    RAISE EXCEPTION 'the current lease holder must resolve the row';
  END IF;
  IF EXISTS (SELECT 1 FROM public.claim_piggyvest_webhook_captures(10, 60, 0)) THEN
    RAISE EXCEPTION 'a processed row must not be claimed again';
  END IF;

  v_status := public.piggyvest_webhook_capture_status();
  IF (v_status->>'pending')::int <> 0 OR (v_status->>'needsReview')::int <> 0
    OR v_status->>'lastProcessedAt' IS NULL THEN
    RAISE EXCEPTION 'status counters are wrong: %', v_status;
  END IF;
END
$$;

-- Configuration-blocked rows must not monopolise the claim. A row the drain
-- cannot verify yet (keys unconfigured, an unreadable archive or family
-- configuration) is released with a bounded backoff: never dead-lettered,
-- without spending the processing attempt budget, and re-entering the queue
-- behind fresher work instead of ahead of it. A plain 'pending' release (a
-- processing failure) keeps its spent attempt but also backs off.
DO $$
DECLARE
  v_blocked uuid;
  v_healthy uuid;
  v_claim record;
  v_row record;
  v_attempts integer;
BEGIN
  DELETE FROM public.piggyvest_webhook_captures;
  -- received_at is immutable evidence, so "oldest" is simply captured first.
  v_blocked := (public.capture_piggyvest_webhook_delivery(
    pg_temp.pv_cmd('\x7b2262223a317d'::bytea, 'evt-blocked', 'bank-transfer.inflow.success', 'txn-blocked')))->>'id';
  v_healthy := (public.capture_piggyvest_webhook_delivery(
    pg_temp.pv_cmd('\x7b2268223a317d'::bytea, 'evt-healthy', 'bank-transfer.inflow.success', 'txn-healthy')))->>'id';

  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_blocked OR v_claim.attempts <> 1 THEN
    RAISE EXCEPTION 'the oldest row must be claimed first: %', v_claim;
  END IF;

  -- A deferral is fenced by the claim token and needs one.
  IF public.resolve_piggyvest_webhook_capture(v_blocked, gen_random_uuid(), 'deferred', 'KEYS_UNCONFIGURED') THEN
    RAISE EXCEPTION 'a wrong claim token must not defer the row';
  END IF;
  BEGIN
    PERFORM public.resolve_piggyvest_webhook_capture(v_blocked, NULL, 'deferred', 'KEYS_UNCONFIGURED');
    RAISE EXCEPTION 'a deferral without a claim must be rejected';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  IF NOT public.resolve_piggyvest_webhook_capture(v_blocked, v_claim.claim_token, 'deferred', 'KEYS_UNCONFIGURED') THEN
    RAISE EXCEPTION 'the lease holder must be able to defer its row';
  END IF;
  SELECT * INTO v_row FROM public.piggyvest_webhook_captures WHERE id = v_blocked;
  IF v_row.processing_state IS DISTINCT FROM 'pending'
    OR v_row.claim_token IS NOT NULL OR v_row.lease_until IS NOT NULL
    OR v_row.last_error IS DISTINCT FROM 'KEYS_UNCONFIGURED'
    OR v_row.attempts <> 0
    OR v_row.config_deferrals <> 1
    OR v_row.next_attempt_at IS NULL
    OR v_row.next_attempt_at NOT BETWEEN clock_timestamp() + interval '55 seconds'
                                      AND clock_timestamp() + interval '65 seconds' THEN
    RAISE EXCEPTION 'a deferral must release the row to pending, refund its attempt and back off ~60s: %', v_row;
  END IF;

  -- The starvation itself: the next claim moves past the blocked row to the
  -- younger healthy one, instead of re-claiming the same blocked row.
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_healthy THEN
    RAISE EXCEPTION 'a deferred row must not hide younger healthy work: %', v_claim;
  END IF;
  IF NOT public.resolve_piggyvest_webhook_capture(v_healthy, v_claim.claim_token, 'processed', NULL) THEN
    RAISE EXCEPTION 'the healthy row must resolve';
  END IF;
  IF EXISTS (SELECT 1 FROM public.claim_piggyvest_webhook_captures(10, 60, 0)) THEN
    RAISE EXCEPTION 'a deferred row must wait for its retry time';
  END IF;

  -- Once the retry time passes it is claimable again, with a full budget.
  UPDATE public.piggyvest_webhook_captures
    SET next_attempt_at = clock_timestamp() - interval '1 second' WHERE id = v_blocked;
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_blocked OR v_claim.attempts <> 1 THEN
    RAISE EXCEPTION 'a due deferred row must be claimable again without a spent attempt: %', v_claim;
  END IF;

  -- The backoff doubles on the separate configuration counter...
  IF NOT public.resolve_piggyvest_webhook_capture(v_blocked, v_claim.claim_token, 'deferred', 'KEYS_UNCONFIGURED') THEN
    RAISE EXCEPTION 'the second deferral must succeed';
  END IF;
  SELECT * INTO v_row FROM public.piggyvest_webhook_captures WHERE id = v_blocked;
  IF v_row.config_deferrals <> 2
    OR v_row.next_attempt_at NOT BETWEEN clock_timestamp() + interval '115 seconds'
                                      AND clock_timestamp() + interval '125 seconds' THEN
    RAISE EXCEPTION 'the second deferral must back off ~120s: %', v_row;
  END IF;

  -- ...is capped at one hour and the counter saturates, and a spent attempt
  -- budget never dead-letters a configuration-blocked row.
  UPDATE public.piggyvest_webhook_captures
    SET next_attempt_at = clock_timestamp() - interval '1 second',
        config_deferrals = 1000, attempts = 20
    WHERE id = v_blocked;
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  IF NOT public.resolve_piggyvest_webhook_capture(v_blocked, v_claim.claim_token, 'deferred', 'KEYS_UNCONFIGURED') THEN
    RAISE EXCEPTION 'a saturated deferral must still succeed';
  END IF;
  SELECT * INTO v_row FROM public.piggyvest_webhook_captures WHERE id = v_blocked;
  IF v_row.processing_state IS DISTINCT FROM 'pending'
    OR v_row.config_deferrals <> 1000
    OR v_row.attempts <> 20
    OR v_row.next_attempt_at NOT BETWEEN clock_timestamp() + interval '3590 seconds'
                                      AND clock_timestamp() + interval '3601 seconds' THEN
    RAISE EXCEPTION 'the backoff must cap at one hour and never dead-letter the row: %', v_row;
  END IF;

  -- A plain pending release (a processing failure) keeps its spent attempt
  -- and the configuration counter, but backs off 30s * 2^attempts (capped at
  -- one hour): a short outage cannot burn the 20-attempt budget in minutes,
  -- and a failing row cannot take every batch ahead of fresher work.
  UPDATE public.piggyvest_webhook_captures
    SET next_attempt_at = clock_timestamp() - interval '1 second', attempts = 3
    WHERE id = v_blocked;
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  v_attempts := v_claim.attempts;
  IF v_attempts <> 4 THEN
    RAISE EXCEPTION 'claim must spend an attempt: %', v_claim;
  END IF;
  IF NOT public.resolve_piggyvest_webhook_capture(v_blocked, v_claim.claim_token, 'pending', 'PROCESSING_INCOMPLETE') THEN
    RAISE EXCEPTION 'a plain pending release must succeed';
  END IF;
  SELECT * INTO v_row FROM public.piggyvest_webhook_captures WHERE id = v_blocked;
  IF v_row.processing_state IS DISTINCT FROM 'pending'
    OR v_row.attempts <> v_attempts
    OR v_row.config_deferrals <> 1000
    OR v_row.next_attempt_at NOT BETWEEN clock_timestamp() + interval '470 seconds'
                                      AND clock_timestamp() + interval '490 seconds' THEN
    RAISE EXCEPTION 'a plain pending release must keep its attempt and back off ~30s * 2^attempts: %', v_row;
  END IF;
  IF EXISTS (SELECT 1 FROM public.claim_piggyvest_webhook_captures(10, 60, 0)) THEN
    RAISE EXCEPTION 'a backed-off pending row must not be claimable before its retry time';
  END IF;

  -- Once its retry time passes it sorts behind work that arrived earlier.
  v_healthy := (public.capture_piggyvest_webhook_delivery(
    pg_temp.pv_cmd('\x7b2268223a337d'::bytea, 'evt-fresh', 'bank-transfer.inflow.success', 'txn-fresh')))->>'id';
  UPDATE public.piggyvest_webhook_captures
    SET next_attempt_at = clock_timestamp() WHERE id = v_blocked;
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_healthy THEN
    RAISE EXCEPTION 'a failing row that is due again must queue behind fresher work: %', v_claim;
  END IF;
  PERFORM public.resolve_piggyvest_webhook_capture(v_healthy, v_claim.claim_token, 'processed', NULL);

  -- The backoff is capped at one hour however many attempts were spent.
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_blocked THEN
    RAISE EXCEPTION 'the failing row must be claimed once nothing is ahead of it: %', v_claim;
  END IF;
  UPDATE public.piggyvest_webhook_captures SET attempts = 12 WHERE id = v_blocked;
  IF NOT public.resolve_piggyvest_webhook_capture(v_blocked, v_claim.claim_token, 'pending', 'PROCESSING_INCOMPLETE') THEN
    RAISE EXCEPTION 'the capped release must succeed';
  END IF;
  SELECT * INTO v_row FROM public.piggyvest_webhook_captures WHERE id = v_blocked;
  IF v_row.attempts <> 12
    OR v_row.next_attempt_at NOT BETWEEN clock_timestamp() + interval '3590 seconds'
                                      AND clock_timestamp() + interval '3601 seconds' THEN
    RAISE EXCEPTION 'a plain pending backoff must cap at one hour: %', v_row;
  END IF;
  UPDATE public.piggyvest_webhook_captures
    SET next_attempt_at = clock_timestamp() - interval '1 second' WHERE id = v_blocked;
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_blocked OR v_claim.attempts <> 13 THEN
    RAISE EXCEPTION 'a due pending row must be claimable again with its attempts kept: %', v_claim;
  END IF;
  IF NOT public.resolve_piggyvest_webhook_capture(v_blocked, v_claim.claim_token, 'processed', NULL) THEN
    RAISE EXCEPTION 'the row must resolve once it can be processed';
  END IF;

  -- A deferred row that is due again re-enters behind work that arrived
  -- before its retry time, not ahead of it.
  DELETE FROM public.piggyvest_webhook_captures;
  v_blocked := (public.capture_piggyvest_webhook_delivery(
    pg_temp.pv_cmd('\x7b2262223a327d'::bytea, 'evt-blocked-2', 'bank-transfer.inflow.success', 'txn-blocked-2')))->>'id';
  v_healthy := (public.capture_piggyvest_webhook_delivery(
    pg_temp.pv_cmd('\x7b2268223a327d'::bytea, 'evt-healthy-2', 'bank-transfer.inflow.success', 'txn-healthy-2')))->>'id';
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_blocked THEN
    RAISE EXCEPTION 'the older row must be claimed first: %', v_claim;
  END IF;
  PERFORM public.resolve_piggyvest_webhook_capture(v_blocked, v_claim.claim_token, 'deferred', 'KEYS_UNCONFIGURED');
  UPDATE public.piggyvest_webhook_captures
    SET next_attempt_at = clock_timestamp() WHERE id = v_blocked;
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_healthy THEN
    RAISE EXCEPTION 'a retry-due row must queue behind work that arrived earlier: %', v_claim;
  END IF;
  PERFORM public.resolve_piggyvest_webhook_capture(v_healthy, v_claim.claim_token, 'processed', NULL);
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_blocked THEN
    RAISE EXCEPTION 'the retry-due row must be claimed once nothing is ahead of it: %', v_claim;
  END IF;

  -- The claim order is index-backed.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'piggyvest_webhook_captures'
      AND indexname = 'piggyvest_webhook_captures_unprocessed_idx'
      AND indexdef LIKE '%next_attempt_at%'
  ) THEN
    RAISE EXCEPTION 'the claim order must be covered by the unprocessed index';
  END IF;
END
$$;
