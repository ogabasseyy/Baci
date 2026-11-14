-- Regression coverage for 20261107121500_piggyvest_capture_claim_recovery.sql.
-- Run after migrations on the private disposable PostgreSQL database only:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--   -f supabase/tests/piggyvest_webhook_capture_claim_recovery.sql
BEGIN;

CREATE FUNCTION pg_temp.pv_recovery_row(p_key text) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.piggyvest_webhook_captures (
    event_key, body_digest, raw_body, signature, key_version,
    key_families, signing_families, key_status
  ) VALUES (
    p_key, repeat('a', 64), convert_to(p_key, 'UTF8'), repeat('b', 128),
    'recovery-test', ARRAY['legacy'], 'legacy', 'current'
  ) RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

-- Isolate claim ordering in this transaction; rollback restores prior rows.
DELETE FROM public.piggyvest_webhook_captures;

DO $$
DECLARE
  v_renew_id uuid := pg_temp.pv_recovery_row('recovery-renew');
  v_expired_id uuid := pg_temp.pv_recovery_row('recovery-expired');
  v_receiver_id uuid := pg_temp.pv_recovery_row('recovery-receiver');
  v_claim record;
  v_renew_token uuid;
  v_expired_token uuid;
  v_receiver_token uuid;
  v_before record;
  v_after record;
  v_status jsonb;
BEGIN
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_renew_id THEN
    RAISE EXCEPTION 'renewal fixture was not claimed first';
  END IF;
  v_renew_token := v_claim.claim_token;

  IF public.resolve_claimed_piggyvest_webhook_capture(
    v_renew_id, gen_random_uuid(), 'renew', NULL) THEN
    RAISE EXCEPTION 'renew accepted a mismatched token';
  END IF;

  SELECT * INTO v_before FROM public.piggyvest_webhook_captures WHERE id = v_renew_id;
  IF NOT public.resolve_claimed_piggyvest_webhook_capture(
    v_renew_id, v_renew_token, 'renew', NULL) THEN
    RAISE EXCEPTION 'live claim renewal failed';
  END IF;
  SELECT * INTO v_after FROM public.piggyvest_webhook_captures WHERE id = v_renew_id;
  IF v_after.processing_state IS DISTINCT FROM 'claimed'
    OR v_after.claim_token IS DISTINCT FROM v_renew_token
    OR v_after.attempts IS DISTINCT FROM v_before.attempts
    OR v_after.lease_until NOT BETWEEN clock_timestamp() + interval '295 seconds'
                                     AND clock_timestamp() + interval '300 seconds'
    OR v_after.body_digest IS DISTINCT FROM v_before.body_digest
    OR v_after.raw_body IS DISTINCT FROM v_before.raw_body
    OR v_after.signature IS DISTINCT FROM v_before.signature THEN
    RAISE EXCEPTION 'renewal changed claim/evidence or did not grant a 300s lease';
  END IF;

  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_expired_id THEN
    RAISE EXCEPTION 'expired-lease fixture was not claimed second';
  END IF;
  v_expired_token := v_claim.claim_token;

  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_receiver_id THEN
    RAISE EXCEPTION 'receiver fixture was not claimed third';
  END IF;
  v_receiver_token := v_claim.claim_token;

  UPDATE public.piggyvest_webhook_captures
  SET lease_until = clock_timestamp() - interval '1 second'
  WHERE id = v_expired_id;
  IF public.resolve_claimed_piggyvest_webhook_capture(
    v_expired_id, v_expired_token, 'renew', NULL) THEN
    RAISE EXCEPTION 'renew accepted an expired lease';
  END IF;

  IF NOT public.resolve_piggyvest_webhook_capture(v_receiver_id, NULL, 'processed', NULL) THEN
    RAISE EXCEPTION 'tokenless successful receiver could not close a claimed row';
  END IF;
  IF public.resolve_claimed_piggyvest_webhook_capture(
    v_receiver_id, v_receiver_token, 'needs_review', 'STALE_WORKER') THEN
    RAISE EXCEPTION 'stale worker changed an already processed row to review';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.piggyvest_webhook_captures
    WHERE id = v_receiver_id AND processing_state = 'processed'
      AND processed_at IS NOT NULL AND claim_token IS NULL AND lease_until IS NULL
      AND last_error IS NULL
  ) THEN
    RAISE EXCEPTION 'receiver completion was overwritten or left stale alert state';
  END IF;

  v_status := public.piggyvest_webhook_capture_status();
  IF v_status->>'claimRecoveryVersion' IS DISTINCT FROM '1'
    OR NOT (v_status ? 'pending') OR NOT (v_status ? 'claimed')
    OR NOT (v_status ? 'needsReview') OR NOT (v_status ? 'oldestUnprocessedAt')
    OR NOT (v_status ? 'lastCapturedAt') OR NOT (v_status ? 'lastProcessedAt') THEN
    RAISE EXCEPTION 'capture status must retain counters and advertise recovery version 1: %', v_status;
  END IF;
END
$$;

ROLLBACK;
