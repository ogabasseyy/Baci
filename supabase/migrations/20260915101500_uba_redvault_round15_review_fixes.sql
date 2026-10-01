-- Round-15 review fixes: merchandise-unit refunds reject duplicate unit
-- identities with a validation error instead of double-counting into a
-- primary-key violation; guest REDVAULT checkouts can be attached to the
-- account created mid-checkout so recovery keeps working after signup.
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
  v_capture_amount bigint;
  v_capture_currency text;
  v_capture_reference text;
  v_capture_status text;
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
  SELECT * INTO v_attempt FROM private.uba_redvault_payment_attempts AS attempt
    WHERE attempt.id = p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.merchant_id IS DISTINCT FROM p_merchant_id THEN
    RAISE EXCEPTION 'redvault_refund_attempt_not_found';
  END IF;
  IF v_attempt.state NOT IN ('captured_held', 'approved') THEN
    RAISE EXCEPTION 'redvault_refund_capture_required';
  END IF;
  IF jsonb_typeof(v_attempt.provider_response) IS DISTINCT FROM 'object'
    OR COALESCE(v_attempt.provider_response->>'capture_amount_kobo', '') !~ '^[1-9][0-9]*$' THEN
    RAISE EXCEPTION 'redvault_refund_capture_evidence_missing';
  END IF;
  v_capture_amount := (v_attempt.provider_response->>'capture_amount_kobo')::bigint;
  v_capture_currency := upper(v_attempt.provider_response->>'capture_currency');
  v_capture_reference := v_attempt.provider_response->>'capture_reference';
  v_capture_status := lower(v_attempt.provider_response->>'capture_status');
  IF v_capture_reference IS DISTINCT FROM v_attempt.reference
    OR v_capture_currency IS DISTINCT FROM v_attempt.currency
    OR v_capture_status IS DISTINCT FROM 'success'
    OR v_capture_amount IS DISTINCT FROM v_attempt.amount_kobo
    OR v_attempt.provider_response->>'held_reason' IS DISTINCT FROM 'provider_eligibility_evidence_unavailable' THEN
    RAISE EXCEPTION 'redvault_refund_capture_evidence_mismatch';
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
    IF p_units IS NOT NULL OR v_reserved >= v_capture_amount THEN
      RAISE EXCEPTION 'redvault_full_refund_unavailable';
    END IF;
    v_amount := v_capture_amount - v_reserved;
  ELSE
    IF jsonb_typeof(p_units) IS DISTINCT FROM 'array' OR jsonb_array_length(p_units) = 0 THEN
      RAISE EXCEPTION 'redvault_refund_units_required';
    END IF;
    -- Allocation links are inserted only after the loop, so the per-unit
    -- already-reserved check cannot see a pair repeated within this same
    -- request: reject duplicates up front instead of double-counting into
    -- a primary-key violation on the bulk insert.
    IF (SELECT count(*) FROM jsonb_array_elements(p_units))
      <> (SELECT count(DISTINCT (value->>'orderItemId', value->>'unitOrdinal'))
          FROM jsonb_array_elements(p_units)) THEN
      RAISE EXCEPTION 'redvault_refund_unit_duplicate';
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
          AND unit_ordinal = (v_unit->>'unitOrdinal')::integer FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'redvault_refund_unit_not_found'; END IF;
      -- Refund links are released only when the refund fails, so an unreleased
      -- link with a non-failed refund covers both an in-flight reservation and
      -- an already-processed refund: neither may reserve the unit again, while
      -- failed refunds stay retryable.
      IF EXISTS (SELECT 1 FROM private.uba_redvault_refund_line_allocations AS link
        JOIN private.uba_redvault_refunds AS refund ON refund.id = link.refund_id
        WHERE link.application_id = v_application.id
          AND link.order_item_id = v_allocation.order_item_id
          AND link.unit_ordinal = v_allocation.unit_ordinal
          AND link.released_at IS NULL AND refund.state <> 'failed') THEN
        RAISE EXCEPTION 'redvault_refund_unit_already_reserved';
      END IF;
      v_amount := v_amount + (v_allocation.unit_price_kobo - v_allocation.allocation_kobo);
    END LOOP;
    IF v_amount <= 0 OR v_amount > v_capture_amount - v_reserved THEN
      RAISE EXCEPTION 'redvault_refund_amount_exceeds_capture';
    END IF;
  END IF;
  INSERT INTO private.uba_redvault_refunds(attempt_id, idempotency_key, amount_kobo, state, refund_type)
    VALUES (p_attempt_id, p_idempotency_key, v_amount, 'pending', p_type) RETURNING * INTO v_refund;
  IF p_type = 'merchandise_units' THEN
    INSERT INTO private.uba_redvault_refund_line_allocations(refund_id, application_id, order_item_id, unit_ordinal, net_amount_kobo)
    SELECT v_refund.id, v_application.id, allocation.order_item_id, allocation.unit_ordinal,
      allocation.unit_price_kobo - allocation.allocation_kobo
    FROM jsonb_array_elements(p_units) unit(value)
    JOIN private.uba_redvault_line_allocations allocation ON allocation.application_id = v_application.id
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

-- Attach a guest REDVAULT checkout to the account created mid-checkout.
-- Guest signup establishes a session, changing auth.uid() after the
-- application and customer rows were created with a null user_id; without
-- this step every customer-bound RPC (attempt recovery, cancellation)
-- rejects the new identity and the live order cannot replay its checkout.
-- Single-claim: only guest rows whose email matches the caller attach, so
-- a later caller can neither steal nor reattach another shopper's order.
CREATE OR REPLACE FUNCTION public.attach_redvault_guest_application_to_customer(
  p_order_id uuid
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid;
  v_email text;
  v_attached bigint := 0;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'forbidden: attach_redvault_guest_application_to_customer requires authenticated';
  END IF;
  v_user := (SELECT auth.uid());
  v_email := lower(btrim(COALESCE(auth.jwt() ->> 'email', '')));
  IF v_user IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'redvault_attach_identity_required';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );

  IF NOT EXISTS (SELECT 1 FROM public.orders o
                 WHERE o.id = p_order_id AND o.payment_method = 'uba_redvault') THEN
    RAISE EXCEPTION 'redvault_attach_order_not_found';
  END IF;

  UPDATE private.uba_redvault_applications application
  SET user_id = v_user
  WHERE application.order_id = p_order_id
    AND application.user_id IS NULL
    AND application.status = 'pending'
    AND lower(btrim(application.customer_email)) = v_email;
  GET DIAGNOSTICS v_attached = ROW_COUNT;

  UPDATE public.customers customer
  SET user_id = v_user
  FROM public.orders o
  WHERE o.id = p_order_id
    AND customer.id = o.customer_id
    AND customer.user_id IS NULL
    AND lower(btrim(customer.email)) = v_email;

  RETURN v_attached > 0;
END;
$$;
ALTER FUNCTION public.attach_redvault_guest_application_to_customer(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.attach_redvault_guest_application_to_customer(uuid)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.attach_redvault_guest_application_to_customer(uuid)
  TO authenticated;
