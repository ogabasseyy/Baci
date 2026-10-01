-- Round-29 review fixes: the shipment-booking claim rejects while a
-- partial REDVAULT refund is still settling (payment_status stays paid, so
-- the refunded check cannot see it), and refund reservation rejects while
-- a live booking lock is held. Together they mutually exclude booking and
-- refund settlement so neither ships stale pre-refund units nor defers
-- reconciliation to review.
-- Partial-refund settlement probe for the shipment-booking claim: true
-- while a merchandise_units refund for the order is still settling
-- (pending/processing/needs_reconciliation) or processed but not yet
-- inventory-reconciled. Processed-and-released partials do not block:
-- their surviving quantities are already written for the booking to read.
CREATE OR REPLACE FUNCTION private.uba_redvault_partial_refund_blocks_booking(p_order_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM private.uba_redvault_refunds AS refund
    JOIN private.uba_redvault_payment_attempts AS attempt ON attempt.id = refund.attempt_id
    LEFT JOIN private.uba_redvault_refund_lifecycle AS lifecycle ON lifecycle.refund_id = refund.id
    WHERE attempt.order_id = p_order_id
      AND refund.refund_type = 'merchandise_units'
      AND (
        refund.state IN ('pending', 'processing', 'needs_reconciliation')
        OR (refund.state = 'processed' AND lifecycle.inventory_state IS DISTINCT FROM 'released')
      )
  );
$$;
ALTER FUNCTION private.uba_redvault_partial_refund_blocks_booking(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.uba_redvault_partial_refund_blocks_booking(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_order_shipment_booking(
  p_order_id uuid,
  p_merchant_id uuid,
  p_lock_token uuid,
  p_lock_timeout_seconds integer DEFAULT 900
)
RETURNS TABLE(
  claimed boolean,
  shipment_id uuid,
  tracking_number text,
  shipping_status text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_payment_status text;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.has_merchant_access(p_merchant_id) THEN
    RAISE EXCEPTION 'forbidden_claim_order_shipment_booking'
      USING ERRCODE = '42501';
  END IF;

  IF p_order_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
    );
  END IF;
  SELECT o.payment_status INTO v_payment_status
  FROM public.orders AS o
  WHERE o.id = p_order_id
    AND o.merchant_id = p_merchant_id
  FOR UPDATE;
  IF FOUND AND lower(btrim(COALESCE(v_payment_status, ''))) = 'refunded' THEN
    RAISE EXCEPTION 'order_refunded_for_shipment';
  END IF;

  -- Partial refunds leave payment_status paid, so the refunded check above
  -- cannot see them: a merchandise refund that is still settling (or
  -- processed but not yet inventory-reconciled) would finalize against the
  -- lock token this claim sets, defer to review without updating
  -- fulfillmentQuantity, and let the booking ship stale pre-refund units.
  -- The helper is SECURITY DEFINER because this claim runs as the caller
  -- (service_role or merchant), which has no grant on the private refund
  -- tables.
  IF private.uba_redvault_partial_refund_blocks_booking(p_order_id) THEN
    RAISE EXCEPTION 'order_refund_pending_for_shipment';
  END IF;

  UPDATE public.orders AS target
  SET shipment_booking_lock_token = p_lock_token,
      shipment_booking_started_at = pg_catalog.now()
  WHERE target.id = p_order_id
    AND target.merchant_id = p_merchant_id
    AND target.shipment_id IS NULL
    AND target.tracking_number IS NULL
    AND (
      target.shipment_booking_lock_token IS NULL
      OR target.shipment_booking_started_at IS NULL
      OR target.shipment_booking_started_at <
        pg_catalog.now() - pg_catalog.make_interval(
          secs => greatest(coalesce(p_lock_timeout_seconds, 900), 900)
        )
    );

  IF FOUND THEN
    RETURN QUERY
    SELECT true, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT false, target.shipment_id, target.tracking_number,
    target.shipping_status
  FROM public.orders AS target
  WHERE target.id = p_order_id
    AND target.merchant_id = p_merchant_id;
END;
$function$;
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
  v_lock_token uuid;
  v_lock_started timestamptz;
  v_amount bigint := 0;
  v_reserved bigint := 0;
  v_unit_net bigint := 0;
  v_unit_vat bigint := 0;
  v_line_vat_kobo bigint := 0;
  v_line_units bigint := 0;
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
  -- A held capture is provider-escrowed funds the approval RPC permanently
  -- rejects once any processed refund exists, while partial-refund
  -- finalization never releases the remainder: only a full-capture
  -- recovery may reserve against the held state, or the order strands in
  -- a non-terminal hold with cancellation and cleanup blocked.
  IF v_attempt.state = 'captured_held' AND p_type <> 'full_capture' THEN
    RAISE EXCEPTION 'redvault_refund_held_full_only';
  END IF;
  -- A live booking lock means a provider submission is in flight with
  -- quantities read before this refund existed: finalizing now would see
  -- the lock token and defer to review while the booking ships stale
  -- pre-refund units. Fail here so the operator retries after booking
  -- settles instead. Stale locks (older than the claim timeout) do not
  -- block: the claim itself would steal them. Together with the claim's
  -- pending-refund rejection this mutually excludes booking and refund
  -- settlement.
  SELECT o.shipment_booking_lock_token, o.shipment_booking_started_at
  INTO v_lock_token, v_lock_started
  FROM public.orders AS o WHERE o.id = v_attempt.order_id;
  IF v_lock_token IS NOT NULL
    AND (v_lock_started IS NULL OR v_lock_started > pg_catalog.now() - pg_catalog.make_interval(secs => 900)) THEN
    RAISE EXCEPTION 'redvault_refund_booking_in_progress';
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
      -- Checkout rounds VAT once per line into order_items.vat_amount;
      -- rounding per unit would over-assign (two N1 units at 7.5% capture
      -- 15 kobo but round to 8 kobo each). Distribute the line's exact
      -- captured VAT across its allocated units instead: every unit takes
      -- the floor share and the first (remainder) ordinals take one kobo
      -- more, so the full line sums to exactly the captured tax.
      v_line_vat_kobo := 0;
      v_line_units := 0;
      SELECT round(COALESCE(oi.vat_amount, 0) * 100)::bigint,
             (SELECT count(*) FROM private.uba_redvault_line_allocations AS line_alloc
               WHERE line_alloc.application_id = v_application.id
                 AND line_alloc.order_item_id = v_allocation.order_item_id)
        INTO v_line_vat_kobo, v_line_units
        FROM public.order_items AS oi
       WHERE oi.id = v_allocation.order_item_id;
      IF v_line_units > 0 AND v_line_vat_kobo > 0 THEN
        v_unit_vat := v_line_vat_kobo / v_line_units
          + CASE WHEN v_allocation.unit_ordinal <= (v_line_vat_kobo % v_line_units)
            THEN 1 ELSE 0 END;
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
    WITH line_vat AS (
      SELECT alloc.order_item_id,
             round(COALESCE(oi.vat_amount, 0) * 100)::bigint AS vat_kobo,
             count(*) AS units
        FROM private.uba_redvault_line_allocations AS alloc
        JOIN public.order_items AS oi ON oi.id = alloc.order_item_id
       WHERE alloc.application_id = v_application.id
         AND alloc.order_item_id IN (
           SELECT DISTINCT (unit.value->>'orderItemId')::uuid
             FROM jsonb_array_elements(p_units) AS unit(value)
         )
       GROUP BY alloc.order_item_id, oi.vat_amount
    )
    INSERT INTO private.uba_redvault_refund_line_allocations(refund_id, application_id, order_item_id, unit_ordinal, net_amount_kobo)
    SELECT v_refund.id, v_application.id, allocation.order_item_id, allocation.unit_ordinal,
      allocation.unit_price_kobo - allocation.allocation_kobo
      + CASE
          WHEN line_vat.units > 0 AND line_vat.vat_kobo > 0
          THEN line_vat.vat_kobo / line_vat.units
            + CASE WHEN allocation.unit_ordinal <= (line_vat.vat_kobo % line_vat.units)
              THEN 1 ELSE 0 END
          ELSE 0
        END
    FROM jsonb_array_elements(p_units) unit(value)
    JOIN private.uba_redvault_line_allocations allocation ON allocation.application_id = v_application.id
      AND allocation.order_item_id = (unit.value->>'orderItemId')::uuid
      AND allocation.unit_ordinal = (unit.value->>'unitOrdinal')::integer
    LEFT JOIN line_vat ON line_vat.order_item_id = allocation.order_item_id;
  END IF;
  RETURN QUERY SELECT v_refund.id, v_refund.amount_kobo, v_refund.state, v_attempt.reference,
    v_refund.provider_reference, v_refund.provider_status;
END;
$$;
ALTER FUNCTION public.reserve_uba_redvault_refund(uuid, uuid, text, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reserve_uba_redvault_refund(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_uba_redvault_refund(uuid, uuid, text, text, jsonb) TO service_role;
