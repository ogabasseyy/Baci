-- REDVAULT refunds are reserved and submitted only by an operator worker. A
-- processed provider status records provider processing, never customer receipt.

ALTER TABLE private.uba_redvault_refunds
  ADD COLUMN IF NOT EXISTS refund_type text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS failure_code text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT pg_catalog.now();

UPDATE private.uba_redvault_refunds SET state = 'pending' WHERE state = 'requested';
ALTER TABLE private.uba_redvault_refunds
  DROP CONSTRAINT IF EXISTS uba_redvault_refunds_state_check;
ALTER TABLE private.uba_redvault_refunds
  ADD CONSTRAINT uba_redvault_refunds_state_check
  CHECK (state IN ('pending', 'processing', 'failed', 'processed'));
ALTER TABLE private.uba_redvault_refunds
  ADD CONSTRAINT uba_redvault_refunds_type_check
  CHECK (refund_type IN ('full_capture', 'merchandise_units'));

CREATE TABLE private.uba_redvault_refund_line_allocations (
  refund_id uuid NOT NULL REFERENCES private.uba_redvault_refunds(id) ON DELETE RESTRICT,
  application_id uuid NOT NULL REFERENCES private.uba_redvault_applications(id) ON DELETE RESTRICT,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE RESTRICT,
  unit_ordinal integer NOT NULL CHECK (unit_ordinal > 0),
  net_amount_kobo bigint NOT NULL CHECK (net_amount_kobo >= 0),
  released_at timestamptz,
  PRIMARY KEY (refund_id, order_item_id, unit_ordinal)
);
CREATE UNIQUE INDEX uba_redvault_refund_unit_active_once
  ON private.uba_redvault_refund_line_allocations(application_id, order_item_id, unit_ordinal)
  WHERE released_at IS NULL;
ALTER TABLE private.uba_redvault_refund_line_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.uba_redvault_refund_line_allocations FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY redvault_refund_line_allocations_no_direct_access
  ON private.uba_redvault_refund_line_allocations AS RESTRICTIVE FOR ALL
  TO anon, authenticated, service_role USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.reserve_uba_redvault_refund(
  p_attempt_id uuid,
  p_merchant_id uuid,
  p_idempotency_key text,
  p_type text,
  p_units jsonb DEFAULT NULL
)
RETURNS TABLE (
  id uuid, amount_kobo bigint, state text, attempt_reference text,
  provider_reference text, provider_status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_application private.uba_redvault_applications%ROWTYPE;
  v_refund private.uba_redvault_refunds%ROWTYPE;
  v_unit jsonb;
  v_allocation private.uba_redvault_line_allocations%ROWTYPE;
  v_amount bigint := 0;
  v_reserved bigint := 0;
BEGIN
  IF p_attempt_id IS NULL OR p_merchant_id IS NULL OR p_idempotency_key IS NULL
    OR length(trim(p_idempotency_key)) = 0 OR length(p_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'redvault_refund_request_invalid';
  END IF;
  IF p_type NOT IN ('full_capture', 'merchandise_units') THEN
    RAISE EXCEPTION 'redvault_refund_type_unsupported';
  END IF;
  SELECT * INTO v_attempt FROM private.uba_redvault_payment_attempts AS attempt WHERE attempt.id = p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.merchant_id IS DISTINCT FROM p_merchant_id THEN
    RAISE EXCEPTION 'redvault_refund_attempt_not_found';
  END IF;
  IF v_attempt.state NOT IN ('captured_held', 'approved') THEN
    RAISE EXCEPTION 'redvault_refund_capture_required';
  END IF;
  SELECT * INTO v_refund FROM private.uba_redvault_refunds AS refund
    WHERE refund.attempt_id = p_attempt_id AND refund.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN QUERY SELECT v_refund.id, v_refund.amount_kobo, v_refund.state, v_attempt.reference,
      v_refund.provider_reference, v_refund.provider_status;
    RETURN;
  END IF;
  SELECT * INTO v_application FROM private.uba_redvault_applications AS application
    WHERE application.id = v_attempt.application_id AND application.merchant_id = p_merchant_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'redvault_refund_application_missing'; END IF;
  SELECT COALESCE(sum(refund.amount_kobo), 0) INTO v_reserved FROM private.uba_redvault_refunds AS refund
    WHERE refund.attempt_id = p_attempt_id AND refund.state IN ('pending', 'processing', 'processed');
  IF p_type = 'full_capture' THEN
    IF p_units IS NOT NULL OR v_reserved <> 0 THEN RAISE EXCEPTION 'redvault_full_refund_unavailable'; END IF;
    v_amount := v_attempt.amount_kobo;
  ELSE
    IF jsonb_typeof(p_units) IS DISTINCT FROM 'array' OR jsonb_array_length(p_units) = 0 THEN
      RAISE EXCEPTION 'redvault_refund_units_required';
    END IF;
    FOR v_unit IN SELECT value FROM jsonb_array_elements(p_units) LOOP
      IF jsonb_typeof(v_unit) IS DISTINCT FROM 'object'
        OR COALESCE(v_unit->>'orderItemId', '') !~ '^[0-9a-fA-F-]{36}$'
        OR COALESCE(v_unit->>'unitOrdinal', '') !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION 'redvault_refund_unit_invalid';
      END IF;
      SELECT * INTO v_allocation FROM private.uba_redvault_line_allocations
        WHERE application_id = v_application.id
          AND order_item_id = (v_unit->>'orderItemId')::uuid
          AND unit_ordinal = (v_unit->>'unitOrdinal')::integer
        FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'redvault_refund_unit_not_found'; END IF;
      IF EXISTS (
        SELECT 1 FROM private.uba_redvault_refund_line_allocations
        WHERE application_id = v_application.id
          AND order_item_id = v_allocation.order_item_id
          AND unit_ordinal = v_allocation.unit_ordinal
          AND released_at IS NULL
      ) THEN RAISE EXCEPTION 'redvault_refund_unit_already_reserved'; END IF;
      v_amount := v_amount + (v_allocation.unit_price_kobo - v_allocation.allocation_kobo);
    END LOOP;
    IF v_amount <= 0 OR v_amount > v_attempt.amount_kobo - v_reserved THEN
      RAISE EXCEPTION 'redvault_refund_amount_exceeds_capture';
    END IF;
  END IF;
  INSERT INTO private.uba_redvault_refunds(attempt_id, idempotency_key, amount_kobo, state, refund_type)
    VALUES (p_attempt_id, p_idempotency_key, v_amount, 'pending', p_type)
    RETURNING * INTO v_refund;
  IF p_type = 'merchandise_units' THEN
    INSERT INTO private.uba_redvault_refund_line_allocations(refund_id, application_id, order_item_id, unit_ordinal, net_amount_kobo)
    SELECT v_refund.id, v_application.id, allocation.order_item_id, allocation.unit_ordinal,
      allocation.unit_price_kobo - allocation.allocation_kobo
    FROM jsonb_array_elements(p_units) unit(value)
    JOIN private.uba_redvault_line_allocations allocation
      ON allocation.application_id = v_application.id
      AND allocation.order_item_id = (unit.value->>'orderItemId')::uuid
      AND allocation.unit_ordinal = (unit.value->>'unitOrdinal')::integer;
  END IF;
  RETURN QUERY SELECT v_refund.id, v_refund.amount_kobo, v_refund.state, v_attempt.reference,
    v_refund.provider_reference, v_refund.provider_status;
END;
$$;
ALTER FUNCTION public.reserve_uba_redvault_refund(uuid, uuid, text, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reserve_uba_redvault_refund(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_uba_redvault_refund(uuid, uuid, text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_next_uba_redvault_refund()
RETURNS TABLE (
  id uuid, amount_kobo bigint, state text, attempt_reference text,
  provider_reference text, provider_status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT refund.id FROM private.uba_redvault_refunds refund
    WHERE refund.state = 'pending'
    ORDER BY refund.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE private.uba_redvault_refunds refund SET state = 'processing', updated_at = pg_catalog.now()
    FROM candidate WHERE refund.id = candidate.id
    RETURNING refund.*
  )
  SELECT refund.id, refund.amount_kobo, refund.state, attempt.reference,
    refund.provider_reference, refund.provider_status
  FROM claimed refund
  JOIN private.uba_redvault_payment_attempts attempt ON attempt.id = refund.attempt_id;
END;
$$;
ALTER FUNCTION public.claim_next_uba_redvault_refund() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_next_uba_redvault_refund() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_uba_redvault_refund() TO service_role;

CREATE OR REPLACE FUNCTION public.finish_uba_redvault_refund(
  p_refund_id uuid,
  p_outcome text,
  p_provider_reference text DEFAULT NULL,
  p_provider_status text DEFAULT NULL
)
RETURNS TABLE (
  id uuid, amount_kobo bigint, state text, attempt_reference text,
  provider_reference text, provider_status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_refund private.uba_redvault_refunds%ROWTYPE;
BEGIN
  IF p_outcome NOT IN ('failed', 'processed') THEN RAISE EXCEPTION 'redvault_refund_outcome_invalid'; END IF;
  SELECT * INTO v_refund FROM private.uba_redvault_refunds AS refund WHERE refund.id = p_refund_id FOR UPDATE;
  IF NOT FOUND OR v_refund.state <> 'processing' THEN RAISE EXCEPTION 'redvault_refund_not_processing'; END IF;
  UPDATE private.uba_redvault_refunds SET state = p_outcome,
    provider_reference = NULLIF(trim(p_provider_reference), ''),
    provider_status = NULLIF(trim(p_provider_status), ''),
    failure_code = CASE WHEN p_outcome = 'failed' THEN 'provider_rejected' ELSE NULL END,
    processed_at = CASE WHEN p_outcome = 'processed' THEN pg_catalog.now() ELSE NULL END,
    updated_at = pg_catalog.now()
  WHERE uba_redvault_refunds.id = p_refund_id RETURNING * INTO v_refund;
  IF p_outcome = 'failed' THEN
    UPDATE private.uba_redvault_refund_line_allocations SET released_at = pg_catalog.now()
    WHERE refund_id = p_refund_id AND released_at IS NULL;
  END IF;
  RETURN QUERY SELECT v_refund.id, v_refund.amount_kobo, v_refund.state, attempt.reference,
    v_refund.provider_reference, v_refund.provider_status
  FROM private.uba_redvault_payment_attempts attempt WHERE attempt.id = v_refund.attempt_id;
END;
$$;
ALTER FUNCTION public.finish_uba_redvault_refund(uuid, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finish_uba_redvault_refund(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_uba_redvault_refund(uuid, text, text, text) TO service_role;
