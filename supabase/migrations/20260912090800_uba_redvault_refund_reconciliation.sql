ALTER TABLE private.uba_redvault_refunds
  ADD COLUMN IF NOT EXISTS reconciliation_claim_token uuid,
  ADD COLUMN IF NOT EXISTS reconciliation_claimed_at timestamptz;

CREATE OR REPLACE FUNCTION public.record_uba_redvault_refund_provider_submission(
  p_refund_id uuid,
  p_provider_reference text,
  p_provider_status text
)
RETURNS TABLE (
  id uuid, amount_kobo bigint, state text, attempt_reference text,
  provider_reference text, provider_status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_refund private.uba_redvault_refunds%ROWTYPE;
BEGIN
  IF NULLIF(trim(p_provider_reference), '') IS NULL OR NULLIF(trim(p_provider_status), '') IS NULL THEN
    RAISE EXCEPTION 'redvault_refund_provider_submission_invalid';
  END IF;
  SELECT * INTO v_refund FROM private.uba_redvault_refunds AS refund WHERE refund.id = p_refund_id FOR UPDATE;
  IF NOT FOUND OR v_refund.state <> 'processing' THEN RAISE EXCEPTION 'redvault_refund_not_processing'; END IF;
  IF v_refund.provider_reference IS NOT NULL AND v_refund.provider_reference IS DISTINCT FROM p_provider_reference THEN
    RAISE EXCEPTION 'redvault_refund_provider_reference_conflict';
  END IF;
  UPDATE private.uba_redvault_refunds SET provider_reference = p_provider_reference,
    provider_status = p_provider_status, updated_at = pg_catalog.now()
  WHERE uba_redvault_refunds.id = p_refund_id RETURNING * INTO v_refund;
  RETURN QUERY SELECT v_refund.id, v_refund.amount_kobo, v_refund.state, attempt.reference,
    v_refund.provider_reference, v_refund.provider_status
  FROM private.uba_redvault_payment_attempts attempt WHERE attempt.id = v_refund.attempt_id;
END;
$$;
ALTER FUNCTION public.record_uba_redvault_refund_provider_submission(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_uba_redvault_refund_provider_submission(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_uba_redvault_refund_provider_submission(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_next_uba_redvault_refund_reconciliation()
RETURNS TABLE (
  id uuid, amount_kobo bigint, state text, attempt_reference text,
  provider_reference text, provider_status text, reconciliation_claim_token uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT refund.id FROM private.uba_redvault_refunds refund
    WHERE refund.state = 'processing'
      AND refund.provider_reference IS NOT NULL
      AND refund.reconciliation_claim_token IS NULL
    ORDER BY refund.updated_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE private.uba_redvault_refunds refund
    SET reconciliation_claim_token = extensions.gen_random_uuid(),
      reconciliation_claimed_at = pg_catalog.now(), updated_at = pg_catalog.now()
    FROM candidate WHERE refund.id = candidate.id
    RETURNING refund.*
  )
  SELECT refund.id, refund.amount_kobo, refund.state, attempt.reference,
    refund.provider_reference, refund.provider_status, refund.reconciliation_claim_token
  FROM claimed refund
  JOIN private.uba_redvault_payment_attempts attempt ON attempt.id = refund.attempt_id;
END;
$$;
ALTER FUNCTION public.claim_next_uba_redvault_refund_reconciliation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_next_uba_redvault_refund_reconciliation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_uba_redvault_refund_reconciliation() TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_uba_redvault_refund(
  p_refund_id uuid,
  p_reconciliation_claim_token uuid,
  p_provider_status text
)
RETURNS TABLE (
  id uuid, amount_kobo bigint, state text, attempt_reference text,
  provider_reference text, provider_status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_refund private.uba_redvault_refunds%ROWTYPE; v_outcome text;
BEGIN
  IF p_provider_status NOT IN ('pending', 'processed', 'failed') THEN
    RAISE EXCEPTION 'redvault_refund_provider_status_untrusted';
  END IF;
  SELECT * INTO v_refund FROM private.uba_redvault_refunds AS refund WHERE refund.id = p_refund_id FOR UPDATE;
  IF NOT FOUND OR v_refund.state <> 'processing'
    OR v_refund.reconciliation_claim_token IS DISTINCT FROM p_reconciliation_claim_token THEN
    RAISE EXCEPTION 'redvault_refund_reconciliation_claim_invalid';
  END IF;
  v_outcome := CASE WHEN p_provider_status = 'pending' THEN 'processing' ELSE p_provider_status END;
  UPDATE private.uba_redvault_refunds SET state = v_outcome,
    provider_status = p_provider_status,
    failure_code = CASE WHEN p_provider_status = 'failed' THEN 'provider_rejected' ELSE failure_code END,
    processed_at = CASE WHEN p_provider_status = 'processed' THEN pg_catalog.now() ELSE processed_at END,
    reconciliation_claim_token = NULL, reconciliation_claimed_at = NULL, updated_at = pg_catalog.now()
  WHERE uba_redvault_refunds.id = p_refund_id RETURNING * INTO v_refund;
  IF p_provider_status = 'failed' THEN
    UPDATE private.uba_redvault_refund_line_allocations SET released_at = pg_catalog.now()
    WHERE refund_id = p_refund_id AND released_at IS NULL;
  END IF;
  RETURN QUERY SELECT v_refund.id, v_refund.amount_kobo, v_refund.state, attempt.reference,
    v_refund.provider_reference, v_refund.provider_status
  FROM private.uba_redvault_payment_attempts attempt WHERE attempt.id = v_refund.attempt_id;
END;
$$;
ALTER FUNCTION public.reconcile_uba_redvault_refund(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reconcile_uba_redvault_refund(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_uba_redvault_refund(uuid, uuid, text) TO service_role;
