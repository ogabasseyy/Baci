-- Round-30 review fixes.
-- P1 (claim/refund races): refund reservation joins the order advisory-lock
-- protocol the shipment-booking claim already uses, so a reservation can no
-- longer read a stale null booking token after the claim's refund check but
-- before its commit. Either side commits first and the other sees it
-- (pending refund vs lock token), so exactly one proceeds.
-- P1 (cancelled claims): cancellation restocks inventory back to sale, so a
-- cancelled order must never book a provider shipment. The claim and the
-- pre-submit payment assertion now reject cancelled payment or shipping
-- states alongside refunded ones.
-- P1 (remainder restock): partial refunds already restock quantity-managed
-- stock per released unit, so a later full_capture remainder must restock
-- only quantities no released partial has restored. Serialized lines keep
-- the full restock: the partial quantity path never touches them.
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
  v_shipping_status text;
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
  SELECT o.payment_status, o.shipping_status
  INTO v_payment_status, v_shipping_status
  FROM public.orders AS o
  WHERE o.id = p_order_id
    AND o.merchant_id = p_merchant_id
  FOR UPDATE;
  IF FOUND AND lower(btrim(COALESCE(v_payment_status, ''))) = 'refunded' THEN
    RAISE EXCEPTION 'order_refunded_for_shipment';
  END IF;
  -- Guest/authenticated cancels set payment_status = 'cancelled' while
  -- legacy merchant/customer cancels set shipping_status = 'cancelled'
  -- (payment may stay paid), and every cancel path restocks inventory.
  -- Booking either representation would ship against stock already
  -- returned to sale. Both spellings are rejected: merchant
  -- cancellation guards accept 'canceled' too.
  IF FOUND AND (
    lower(btrim(COALESCE(v_payment_status, ''))) IN ('cancelled', 'canceled')
    OR lower(btrim(COALESCE(v_shipping_status, ''))) IN ('cancelled', 'canceled')
  ) THEN
    RAISE EXCEPTION 'order_cancelled_for_shipment';
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
  v_shipping_status text;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.has_merchant_access(p_merchant_id) THEN
    RAISE EXCEPTION 'forbidden_assert_shippable_order_payment'
      USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );
  SELECT o.payment_status, o.shipping_status
  INTO v_payment_status, v_shipping_status
  FROM public.orders AS o
  WHERE o.id = p_order_id AND o.merchant_id = p_merchant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found_for_shipment';
  END IF;
  IF lower(btrim(COALESCE(v_payment_status, ''))) = 'refunded' THEN
    RAISE EXCEPTION 'order_refunded_for_shipment';
  END IF;
  -- Same cancelled-order rejection as the booking claim: a cancel that
  -- lands between the claim and provider submission restocks inventory,
  -- so the pre-submit check must fail closed too.
  IF lower(btrim(COALESCE(v_payment_status, ''))) IN ('cancelled', 'canceled')
    OR lower(btrim(COALESCE(v_shipping_status, ''))) IN ('cancelled', 'canceled') THEN
    RAISE EXCEPTION 'order_cancelled_for_shipment';
  END IF;
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
  -- Join the order advisory-lock protocol before inspecting the booking
  -- token: the shipment-booking claim holds this same lock while
  -- checking for refunds, then sets the token. Without it this
  -- reservation could observe a stale null token after the claim's
  -- refund check but before its commit, letting a provider booking and
  -- this refund proceed together. The xact-scoped lock serializes the
  -- two transactions, so whichever commits first is visible to the
  -- other's check (pending refund row vs lock token) and exactly one
  -- proceeds. Lock order matches the claim and refund finalization
  -- (advisory first, then row locks), so no new cycle is introduced.
  IF v_attempt.order_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('baci_order_payment:' || v_attempt.order_id::text, 0)
    );
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
-- Full-remainder restock that skips units earlier partials already
-- released: each processed merchandise_units refund with a released
-- lifecycle restocked its quantity-managed units through
-- release_redvault_refund_quantity_units, so restocking the full
-- order_items.quantity again would double-count them back into
-- sellable stock. Only lifecycle 'released' counts: refunds stuck in
-- review never restored stock and must still restock here.
-- Serialized lines restock in full: the partial quantity path skips
-- them (units release through variant_inventory, which only touches
-- still-reserved units and is therefore already idempotent).
CREATE OR REPLACE FUNCTION private.restock_order_items_excluding_redvault_releases(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.product_variants v
  SET stock_quantity = v.stock_quantity + agg.qty
  FROM (
    SELECT oi.variant_id AS variant_id,
      SUM(CASE
        WHEN p.inventory_tracking_policy = 'serialized_strict'
          AND COALESCE(variant.inventory_tracking_policy, 'inherit') IN ('inherit', 'serialized_strict')
        THEN oi.quantity
        ELSE GREATEST(oi.quantity - COALESCE(rel.released, 0), 0)
      END)::int AS qty
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
    LEFT JOIN public.product_variants AS variant ON variant.id = oi.variant_id
    LEFT JOIN (
      SELECT link.order_item_id, count(*)::int AS released
      FROM private.uba_redvault_refund_line_allocations AS link
      JOIN private.uba_redvault_refunds AS refund ON refund.id = link.refund_id
      JOIN private.uba_redvault_refund_lifecycle AS lifecycle ON lifecycle.refund_id = refund.id
      JOIN private.uba_redvault_payment_attempts AS attempt ON attempt.id = refund.attempt_id
      WHERE attempt.order_id = p_order_id
        AND refund.state = 'processed'
        AND lifecycle.inventory_state = 'released'
      GROUP BY link.order_item_id
    ) rel ON rel.order_item_id = oi.id
    WHERE oi.order_id = p_order_id
      AND oi.variant_id IS NOT NULL
      AND COALESCE(p.manage_stock, false) = true
    GROUP BY oi.variant_id
  ) agg
  WHERE v.id = agg.variant_id;

  UPDATE public.products p
  SET stock_quantity = COALESCE(p.stock_quantity, 0) + agg.qty
  FROM (
    SELECT oi.product_id AS product_id,
      SUM(CASE
        WHEN pp.inventory_tracking_policy = 'serialized_strict'
        THEN oi.quantity
        ELSE GREATEST(oi.quantity - COALESCE(rel.released, 0), 0)
      END)::int AS qty
    FROM public.order_items oi
    JOIN public.products pp ON pp.id = oi.product_id
    LEFT JOIN (
      SELECT link.order_item_id, count(*)::int AS released
      FROM private.uba_redvault_refund_line_allocations AS link
      JOIN private.uba_redvault_refunds AS refund ON refund.id = link.refund_id
      JOIN private.uba_redvault_refund_lifecycle AS lifecycle ON lifecycle.refund_id = refund.id
      JOIN private.uba_redvault_payment_attempts AS attempt ON attempt.id = refund.attempt_id
      WHERE attempt.order_id = p_order_id
        AND refund.state = 'processed'
        AND lifecycle.inventory_state = 'released'
      GROUP BY link.order_item_id
    ) rel ON rel.order_item_id = oi.id
    WHERE oi.order_id = p_order_id
      AND oi.variant_id IS NULL
      AND oi.product_id IS NOT NULL
      AND COALESCE(pp.manage_stock, false) = true
    GROUP BY oi.product_id
  ) agg
  WHERE p.id = agg.product_id;
END;
$$;
ALTER FUNCTION private.restock_order_items_excluding_redvault_releases(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.restock_order_items_excluding_redvault_releases(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.resolve_uba_redvault_refund_inventory_review(
  p_refund_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
  v_quantity_receipt jsonb;
  v_refund private.uba_redvault_refunds%ROWTYPE;
  v_lifecycle private.uba_redvault_refund_lifecycle%ROWTYPE;
  v_order public.orders%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: REDVAULT refund review resolution requires service_role';
  END IF;

  SELECT * INTO STRICT v_refund
  FROM private.uba_redvault_refunds
  WHERE id = p_refund_id;
  SELECT * INTO STRICT v_lifecycle
  FROM private.uba_redvault_refund_lifecycle
  WHERE refund_id = p_refund_id
  FOR UPDATE;

  IF v_lifecycle.inventory_state <> 'review_required' THEN
    RETURN jsonb_build_object('success', true, 'refundId', p_refund_id,
      'inventoryState', v_lifecycle.inventory_state);
  END IF;

  IF v_refund.refund_type = 'full_capture' THEN
    -- Full captures carry no unit links, so the partial-unit helper always
    -- rejects them: resolve through the same full-order release the
    -- processed-refund finalization uses. The serialized-policy gate that
    -- queued this review is operator judgment now, but the shipment-state
    -- gates are re-enforced: released inventory must never cover goods
    -- that already shipped.
    SELECT * INTO STRICT v_order FROM public.orders WHERE id = v_lifecycle.order_id FOR UPDATE;
    IF v_refund.state <> 'processed'
      OR v_order.shipping_status NOT IN ('pending', 'processing') OR v_order.cancelled_at IS NOT NULL
      OR v_order.shipment_id IS NOT NULL OR v_order.tracking_number IS NOT NULL
      OR v_order.shipped_at IS NOT NULL OR v_order.delivered_at IS NOT NULL
      OR v_order.shipment_booking_lock_token IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.shipments WHERE order_id = v_order.id) THEN
      RAISE EXCEPTION 'redvault_full_refund_inventory_requires_review';
    END IF;
    -- The complete full-order path, mirroring merchant cancellation:
    -- quantity-managed stock restocks (minus units earlier released
    -- partials already restored, so a partial-then-remainder sequence
    -- cannot double-restock), then serialized units release.
    -- Release-only would report success with zero units for a
    -- manage_stock order while its decremented stock stays unrestored.
    PERFORM private.restock_order_items_excluding_redvault_releases(v_order.id);
    v_result := private.release_order_inventory_units(v_order.merchant_id, v_order.id, 'available');
    IF (v_result->>'success')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'redvault_refund_inventory_release_failed';
    END IF;
    v_result := v_result || jsonb_build_object('releasePath', 'full_order');
  ELSE
    -- Mixed/quantity carts: the units helper rejects any non-serialized
    -- line, so quantity-managed lines resolve through the quantity path
    -- first, then the serialized remainder (if any) releases unit-by-unit.
    v_quantity_receipt := private.release_redvault_refund_quantity_units(p_refund_id);
    IF EXISTS (
      SELECT 1 FROM private.uba_redvault_refund_line_allocations AS allocation
      JOIN public.order_items AS item ON item.id = allocation.order_item_id
      JOIN public.products AS product ON product.id = item.product_id
      LEFT JOIN public.product_variants AS variant ON variant.id = item.variant_id
      WHERE allocation.refund_id = p_refund_id
        AND product.inventory_tracking_policy = 'serialized_strict'
        AND (item.variant_id IS NULL OR COALESCE(variant.inventory_tracking_policy, 'inherit')
          IN ('inherit', 'serialized_strict'))
    ) THEN
      v_result := private.release_redvault_refund_inventory_units(p_refund_id);
      v_result := v_result || jsonb_build_object(
        'restockedCount', COALESCE((v_quantity_receipt->>'restockedCount')::integer, 0),
        'releasePath', CASE WHEN COALESCE((v_quantity_receipt->>'quantityLines')::integer, 0) > 0
          THEN 'mixed_units' ELSE 'refund_units' END);
    ELSE
      v_result := v_quantity_receipt || jsonb_build_object('releasePath', 'quantity_units');
    END IF;
  END IF;
  UPDATE private.uba_redvault_refund_lifecycle
  SET inventory_state = 'released', review_reason = NULL, inventory_receipt = v_result
  WHERE refund_id = p_refund_id AND inventory_state = 'review_required';
  UPDATE public.reconciliation_review
  SET resolved_at = pg_catalog.clock_timestamp(),
      resolution_notes = 'REDVAULT refund inventory safely released by protected resolver.'
  WHERE issue_type = 'serialized_inventory_confirmation_failed'
    AND order_id = v_lifecycle.order_id
    AND (metadata->>'refundId' = p_refund_id::text
      OR metadata->'refundIds' ? p_refund_id::text)
    AND resolved_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM private.uba_redvault_refund_lifecycle AS remaining
      WHERE remaining.order_id = v_lifecycle.order_id
        AND remaining.inventory_state = 'review_required'
        AND remaining.refund_id IS DISTINCT FROM p_refund_id
    );
  RETURN v_result || jsonb_build_object('inventoryState', 'released');
END;
$$;
ALTER FUNCTION public.resolve_uba_redvault_refund_inventory_review(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_uba_redvault_refund_inventory_review(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_uba_redvault_refund_inventory_review(uuid)
  TO service_role;
