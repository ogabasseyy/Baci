-- Round-20 review fixes: the GIGL direct-split wrapper caps retention
-- against gross minus platform fee only (the Paystack gateway fee is
-- account-borne, so subtracting it understates retention and overstates
-- merchant net versus the provider split); merchandise-unit refunds add
-- the exclusive-basis VAT captured on each unit; shipment booking gets a
-- serialized pre-submit payment-state check against refund finalization.
CREATE OR REPLACE FUNCTION public.record_uba_redvault_direct_settlement_gigl_v1(
  p_merchant_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_gateway text,
  p_gateway_reference text,
  p_gross_amount numeric,
  p_gateway_fee numeric,
  p_platform_fee numeric,
  p_description text,
  p_metadata jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_snapshot numeric(12,2) := 0;
  v_already_retained numeric(12,2) := 0;
  v_internal_credit numeric(12,2) := 0;
  v_remaining numeric(12,2) := 0;
  v_retained numeric(12,2) := 0;
  v_metadata jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: record_uba_redvault_direct_settlement_gigl_v1 requires service_role';
  END IF;
  IF p_source_type = 'order' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('merchant-shipping-order:' || p_source_id::text, 0)
    );

    SELECT CASE
      WHEN o.shipping_funding_source = 'customer_checkout'
       AND pg_catalog.upper(pg_catalog.btrim(COALESCE(o.shipping_provider, ''))) = 'GIGL'
       AND o.shipping_pricing_version = 'gigl_platform_margin_v1'
      THEN GREATEST(COALESCE(o.shipping_platform_retained_amount, 0), 0)
      ELSE 0
    END
      INTO v_snapshot
      FROM public.orders o
     WHERE o.id = p_source_id
       AND o.merchant_id = p_merchant_id;

    SELECT COALESCE(SUM(
      GREATEST(
        COALESCE((settlement.metadata ->> 'retained_shipping_amount')::numeric, 0),
        0
      )
    ), 0)
      INTO v_already_retained
      FROM public.merchant_settlements AS settlement
     WHERE settlement.source_type = 'order'
       AND settlement.source_id = p_source_id
       AND settlement.merchant_id = p_merchant_id
       AND settlement.status IS DISTINCT FROM 'cancelled';

    IF v_snapshot > 0 THEN
      SELECT GREATEST(
        COALESCE((
          SELECT SUM(GREATEST(COALESCE(t.amount, 0), 0))
          FROM public.transactions AS t
          WHERE t.merchant_id = p_merchant_id
            AND t.order_id = p_source_id
            AND t.status = 'completed'
            AND lower(btrim(COALESCE(t.gateway, ''))) = ANY (
              ARRAY['wallet', 'savings', 'store_credit']::text[]
            )
        ), 0),
        COALESCE((
          SELECT SUM(GREATEST(COALESCE(w.amount, 0), 0))
          FROM public.customer_wallet_transactions AS w
          WHERE w.merchant_id = p_merchant_id
            AND w.source_type = 'order_redemption'
            AND w.source_id = p_source_id
            AND w.status = 'completed'
        ), 0)
        + COALESCE((
          SELECT SUM(GREATEST(COALESCE(s.amount, 0), 0))
          FROM public.customer_savings_redemptions AS s
          WHERE s.merchant_id = p_merchant_id
            AND s.order_id = p_source_id
            AND s.metadata->>'reversed_at' IS NULL
        ), 0)
      )
        INTO v_internal_credit;
      v_already_retained := v_already_retained
        + LEAST(
          GREATEST(v_snapshot - v_already_retained, 0),
          GREATEST(COALESCE(v_internal_credit, 0), 0)
        );
    END IF;
  END IF;

  v_remaining := GREATEST(v_snapshot - v_already_retained, 0);
  -- Account-borne gateway fee: Paystack deducts it from the platform
  -- share (bearer 'account'), and the provider split withholds the frozen
  -- retention up to gross minus platform fee — so the wrapper caps
  -- against that same bound instead of subtracting the gateway fee again.
  v_retained := LEAST(
    v_remaining,
    GREATEST(
      COALESCE(p_gross_amount, 0)
        - COALESCE(p_platform_fee, 0),
      0
    )
  );
  v_metadata := COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'retained_shipping_amount', v_retained
  );
  RETURN public.record_uba_redvault_direct_settlement(
    p_merchant_id, p_source_type, p_source_id, p_gateway,
    p_gateway_reference, p_gross_amount, p_gateway_fee,
    p_platform_fee + v_retained, p_description, v_metadata
  );
END;
$$;
ALTER FUNCTION public.record_uba_redvault_direct_settlement_gigl_v1(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_uba_redvault_direct_settlement_gigl_v1(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_uba_redvault_direct_settlement_gigl_v1(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb
) TO service_role;

-- Merchandise-unit refunds must return the VAT captured with each unit.
-- REDVAULT orders use an exclusive tax basis with the discount applied at
-- order level, so the captured total charges VAT on the gross unit price
-- (ROUND(price * rate / 100) per standard-rated line). Refunding only the
-- discounted net leaves the customer charged the unit's tax.
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
  v_unit_net bigint := 0;
  v_unit_vat bigint := 0;
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
  -- A needs_reconciliation refund is a provider timeout that may already
  -- have completed externally: its amount stays reserved until it fails or
  -- finalizes, or a second reservation with another idempotency key could
  -- refund the same capture twice. Failed refunds stay excluded (retryable).
  SELECT COALESCE(sum(refund.amount_kobo), 0) INTO v_reserved FROM private.uba_redvault_refunds AS refund
    WHERE refund.attempt_id = p_attempt_id AND refund.state IN ('pending', 'processing', 'needs_reconciliation', 'processed');
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
      v_unit_net := v_allocation.unit_price_kobo - v_allocation.allocation_kobo;
      IF COALESCE(upper(v_allocation.vat_category_code), 'S') = 'S'
        AND COALESCE(v_allocation.vat_rate_bp, 0) > 0 THEN
        v_unit_vat := floor((
          v_allocation.unit_price_kobo::numeric * v_allocation.vat_rate_bp + 5000
        ) / 10000)::bigint;
      ELSE
        v_unit_vat := 0;
      END IF;
      v_amount := v_amount + v_unit_net + v_unit_vat;
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
      + CASE
          WHEN COALESCE(upper(allocation.vat_category_code), 'S') = 'S'
            AND COALESCE(allocation.vat_rate_bp, 0) > 0
          THEN floor((
            allocation.unit_price_kobo::numeric * allocation.vat_rate_bp + 5000
          ) / 10000)::bigint
          ELSE 0
        END
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

-- Serialized pre-submit payment check for shipment booking. Booking reads
-- the order long before the provider call, and refund finalization marks
-- payment_status = 'refunded' even while a booking lock is held — so the
-- booking path re-checks here, under the same advisory lock + row lock
-- order the refund trigger uses, immediately before provider submission.
CREATE OR REPLACE FUNCTION public.assert_shippable_order_payment(
  p_order_id uuid,
  p_merchant_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_payment_status text;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.has_merchant_access(p_merchant_id) THEN
    RAISE EXCEPTION 'forbidden_assert_shippable_order_payment'
      USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );
  SELECT o.payment_status INTO v_payment_status
  FROM public.orders AS o
  WHERE o.id = p_order_id AND o.merchant_id = p_merchant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found_for_shipment';
  END IF;
  IF lower(btrim(COALESCE(v_payment_status, ''))) = 'refunded' THEN
    RAISE EXCEPTION 'order_refunded_for_shipment';
  END IF;
END;
$function$;
