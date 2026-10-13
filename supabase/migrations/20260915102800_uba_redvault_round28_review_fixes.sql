-- Round-28 review fixes: the anon-accessible payment snapshot stops
-- returning the tracking token (ownership proof moves to a boolean RPC),
-- REDVAULT cancellation restocks quantity-managed stock like ordinary
-- cancellation, and partial-refund inventory resolution gains a
-- quantity-managed path so mixed/non-serialized carts no longer strand in
-- review (wired into both the review resolver and processed-refund
-- finalization).
-- The bounded snapshot no longer returns the tracking token: it is
-- executable by UUID+email holders, who could otherwise harvest the token
-- and defeat every order-bound proof check. Ownership proof moves to the
-- boolean verify_order_tracking_token RPC below.
DROP FUNCTION IF EXISTS public.get_order_payment_snapshot(uuid, text);
CREATE FUNCTION public.get_order_payment_snapshot(p_order_id uuid, p_email text)
RETURNS TABLE(merchant_id uuid, total numeric, currency text, shipping_status text, payment_status text, merchant_country text, payment_method text, wallet_amount_used numeric)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT o.merchant_id, o.total, o.currency, o.shipping_status, o.payment_status, m.country, o.payment_method, o.wallet_amount_used
  FROM public.orders AS o
  JOIN public.merchants AS m ON m.id = o.merchant_id
  WHERE o.id = p_order_id
    AND pg_catalog.lower(o.customer_email) = pg_catalog.lower(pg_catalog.btrim(p_email))
  LIMIT 1;
$$;
ALTER FUNCTION public.get_order_payment_snapshot(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_order_payment_snapshot(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_payment_snapshot(uuid, text) TO anon, authenticated, service_role;

-- Ownership proof without disclosure: verification happens here and only
-- a boolean leaves the database. Brute force over the 32-char random token
-- is infeasible, and the grant excludes anon regardless.
CREATE OR REPLACE FUNCTION public.verify_order_tracking_token(
  p_order_id uuid,
  p_tracking_token text
)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders AS o
    WHERE o.id = p_order_id
      AND NULLIF(btrim(p_tracking_token), '') IS NOT NULL
      AND o.tracking_token = p_tracking_token
  );
$$;
ALTER FUNCTION public.verify_order_tracking_token(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.verify_order_tracking_token(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.verify_order_tracking_token(uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_uba_redvault_order_as_customer(
  p_order_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = '' AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_reason text;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'forbidden: cancel_uba_redvault_order_as_customer requires authenticated';
  END IF;
  v_reason := NULLIF(btrim(p_reason), '');
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'reason_too_long' USING ERRCODE = '22001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );

  SELECT o.* INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
    AND o.customer_id IN (
      SELECT c.id FROM public.customers c
      WHERE c.user_id = (SELECT auth.uid())
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent: already cancelled -> no-op, do not re-release.
  IF v_order.shipping_status = 'cancelled' THEN
    RETURN false;
  END IF;

  IF v_order.payment_method IS DISTINCT FROM 'uba_redvault'
    OR v_order.payment_status IS DISTINCT FROM 'unpaid'
    OR v_order.shipping_status NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'order_not_cancellable' USING ERRCODE = 'P0001';
  END IF;

  -- An initialized attempt holds a live hosted Paystack URL: expiring local
  -- payment-account rows cannot invalidate the already-open checkout page,
  -- so a completed payment would be captured and held while approval
  -- rejects the cancelled order. `initializing` and `indeterminate` are
  -- equally ambiguous (provider POST in flight / timed out while Paystack
  -- may hold a transaction), so they stay blocked until reconciliation
  -- proves the authorization can no longer succeed.
  IF EXISTS (SELECT 1 FROM private.uba_redvault_payment_attempts AS attempt
             WHERE attempt.order_id = p_order_id
               AND attempt.state IN ('initializing', 'indeterminate', 'initialized', 'captured_held', 'capture_evidence_review', 'approved')) THEN
    RAISE EXCEPTION 'redvault_customer_cancel_active' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM private.uba_redvault_refunds AS refund
             JOIN private.uba_redvault_payment_attempts AS attempt ON attempt.id = refund.attempt_id
             WHERE attempt.order_id = p_order_id
               AND refund.state IN ('pending', 'processing', 'needs_reconciliation', 'processed')) THEN
    RAISE EXCEPTION 'redvault_customer_cancel_active' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;

  UPDATE public.orders o
  SET payment_status = 'cancelled',
      shipping_status = 'cancelled',
      cancelled_at = pg_catalog.now(),
      cancellation_reason = v_reason,
      cancelled_by = 'customer',
      updated_at = pg_catalog.now()
  WHERE o.id = p_order_id;

  -- Void already-issued payment instruments so a later inbound payment
  -- cannot be matched back to this cancelled order.
  UPDATE public.order_payment_accounts a
  SET expires_at = pg_catalog.now()
  WHERE a.order_id = p_order_id
    AND (a.expires_at IS NULL OR a.expires_at > pg_catalog.now());

  UPDATE public.order_wallet_funding_intents i
  SET status = 'cancelled', updated_at = pg_catalog.now()
  WHERE i.order_id = p_order_id
    AND i.status NOT IN ('completed', 'cancelled', 'expired', 'failed');
  -- Quantity-managed stock restocks on REDVAULT cancellation exactly as
  -- on ordinary cancellation: the payment_status trigger only releases
  -- serialized units, so without this every manage_stock REDVAULT cancel
  -- permanently leaks decremented stock.
  PERFORM private.restock_order_items(p_order_id);

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  RETURN true;
END;
$$;
ALTER FUNCTION public.cancel_uba_redvault_order_as_customer(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_uba_redvault_order_as_customer(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.cancel_uba_redvault_order_as_customer(uuid, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_storefront_order_as_guest(
  p_order_id uuid,
  p_tracking_token text,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = '' AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_reason text;
BEGIN
  v_reason := NULLIF(btrim(p_reason), '');
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'reason_too_long' USING ERRCODE = '22001';
  END IF;
  IF p_order_id IS NULL OR NULLIF(btrim(p_tracking_token), '') IS NULL THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );

  SELECT o.* INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
    AND o.tracking_token = p_tracking_token
    AND o.customer_id IN (
      SELECT c.id FROM public.customers c
      WHERE c.user_id IS NULL
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent: already cancelled -> no-op, do not re-release.
  IF v_order.shipping_status = 'cancelled' THEN
    RETURN false;
  END IF;

  IF v_order.payment_method = 'uba_redvault' THEN
    IF v_order.payment_status IS DISTINCT FROM 'unpaid'
      OR v_order.shipping_status NOT IN ('pending', 'processing') THEN
      RAISE EXCEPTION 'order_not_cancellable' USING ERRCODE = 'P0001';
    END IF;
    -- Mirror the customer RPC: a live hosted URL, an ambiguous
    -- initialization (`initializing`/`indeterminate`), or an in-flight
    -- refund keeps the order active until the authorization can no longer
    -- succeed.
    IF EXISTS (SELECT 1 FROM private.uba_redvault_payment_attempts AS attempt
               WHERE attempt.order_id = p_order_id
                 AND attempt.state IN ('initializing', 'indeterminate', 'initialized', 'captured_held', 'capture_evidence_review', 'approved')) THEN
      RAISE EXCEPTION 'redvault_guest_cancel_active' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM private.uba_redvault_refunds AS refund
               JOIN private.uba_redvault_payment_attempts AS attempt ON attempt.id = refund.attempt_id
               WHERE attempt.order_id = p_order_id
                 AND refund.state IN ('pending', 'processing', 'needs_reconciliation', 'processed')) THEN
      RAISE EXCEPTION 'redvault_guest_cancel_active' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
    ON CONFLICT DO NOTHING;

    UPDATE public.orders o
    SET payment_status = 'cancelled',
        shipping_status = 'cancelled',
        cancelled_at = pg_catalog.now(),
        cancellation_reason = v_reason,
        cancelled_by = 'customer',
        updated_at = pg_catalog.now()
    WHERE o.id = p_order_id;

    UPDATE public.order_payment_accounts a
    SET expires_at = pg_catalog.now()
    WHERE a.order_id = p_order_id
      AND (a.expires_at IS NULL OR a.expires_at > pg_catalog.now());

    UPDATE public.order_wallet_funding_intents i
    SET status = 'cancelled', updated_at = pg_catalog.now()
    WHERE i.order_id = p_order_id
      AND i.status NOT IN ('completed', 'cancelled', 'expired', 'failed');
  -- Quantity-managed stock restocks on REDVAULT cancellation exactly as
  -- on ordinary cancellation: the payment_status trigger only releases
  -- serialized units, so without this every manage_stock REDVAULT cancel
  -- permanently leaks decremented stock.
    PERFORM private.restock_order_items(p_order_id);

    DELETE FROM private.uba_redvault_write_context
    WHERE transaction_id = pg_catalog.txid_current();

    RETURN true;
  END IF;

  IF NOT private.order_customer_cancellable(p_order_id) THEN
    RAISE EXCEPTION 'order_not_cancellable' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.orders o
  SET shipping_status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = v_reason,
      cancelled_by = 'customer',
      updated_at = now()
  WHERE o.id = p_order_id;

  UPDATE public.order_payment_accounts a
  SET expires_at = now()
  WHERE a.order_id = p_order_id
    AND (a.expires_at IS NULL OR a.expires_at > now());

  UPDATE public.order_wallet_funding_intents i
  SET status = 'cancelled', updated_at = now()
  WHERE i.order_id = p_order_id
    AND i.status NOT IN ('completed', 'cancelled', 'expired', 'failed');

  PERFORM private.restock_order_items(p_order_id);

  RETURN true;
END;
$$;
ALTER FUNCTION public.cancel_storefront_order_as_guest(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_storefront_order_as_guest(uuid, text, text)
  FROM PUBLIC, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.cancel_storefront_order_as_guest(uuid, text, text)
  TO anon, authenticated;

-- Quantity-managed counterpart to the serialized-unit release helper: a
-- partial refund whose lines are not serialized_strict can never release
-- through variant_inventory, so resolve those lines here by restoring
-- per-line stock and recording the surviving shippable count. Serialized
-- lines are skipped for the unit-release helper. The surviving count is
-- recomputed cumulatively across processed refunds, so re-resolution is
-- idempotent; callers run this inside their savepoint/statement scope so a
-- subsequent serialized failure rolls the restock back with it.
CREATE OR REPLACE FUNCTION private.release_redvault_refund_quantity_units(p_refund_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_refund private.uba_redvault_refunds%ROWTYPE;
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_request record;
  v_item public.order_items%ROWTYPE;
  v_restocked integer := 0;
  v_quantity_lines integer := 0;
  v_refunded_total integer;
  v_surviving integer;
BEGIN
  SELECT * INTO STRICT v_refund FROM private.uba_redvault_refunds WHERE id = p_refund_id;
  SELECT * INTO STRICT v_attempt FROM private.uba_redvault_payment_attempts WHERE id = v_refund.attempt_id;
  SELECT * INTO STRICT v_order FROM public.orders WHERE id = v_attempt.order_id FOR UPDATE;
  IF v_refund.state <> 'processed' OR v_refund.refund_type <> 'merchandise_units'
    OR v_order.shipping_status NOT IN ('pending', 'processing') OR v_order.cancelled_at IS NOT NULL
    OR v_order.shipment_id IS NOT NULL OR v_order.tracking_number IS NOT NULL
    OR v_order.shipped_at IS NOT NULL OR v_order.delivered_at IS NOT NULL
    OR v_order.shipment_booking_lock_token IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.shipments WHERE order_id = v_order.id) THEN
    RAISE EXCEPTION 'redvault_partial_refund_inventory_requires_review';
  END IF;
  FOR v_request IN
    SELECT allocation.order_item_id, count(*)::integer AS requested_count
    FROM private.uba_redvault_refund_line_allocations AS allocation
    WHERE allocation.refund_id = p_refund_id
    GROUP BY allocation.order_item_id
  LOOP
    SELECT * INTO STRICT v_item FROM public.order_items WHERE id = v_request.order_item_id
      AND order_id = v_order.id FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM public.products AS product
      LEFT JOIN public.product_variants AS variant ON variant.id = v_item.variant_id
      WHERE product.id = v_item.product_id
        AND product.inventory_tracking_policy = 'serialized_strict'
        AND (v_item.variant_id IS NULL OR COALESCE(variant.inventory_tracking_policy, 'inherit')
          IN ('inherit', 'serialized_strict'))
    ) THEN CONTINUE; END IF;
    v_quantity_lines := v_quantity_lines + 1;
    -- Mirror restock_order_items level selection: variant stock when a
    -- variant is set, product stock otherwise, gated on manage_stock.
    IF v_item.variant_id IS NOT NULL THEN
      UPDATE public.product_variants AS variant
      SET stock_quantity = COALESCE(variant.stock_quantity, 0) + v_request.requested_count
      FROM public.products AS product
      WHERE variant.id = v_item.variant_id AND product.id = v_item.product_id
        AND product.manage_stock = true;
    ELSE
      UPDATE public.products AS product
      SET stock_quantity = COALESCE(product.stock_quantity, 0) + v_request.requested_count
      WHERE product.id = v_item.product_id AND product.manage_stock = true;
    END IF;
    IF FOUND THEN
      v_restocked := v_restocked + v_request.requested_count;
    END IF;
    -- The surviving shippable count always reconciles, even for untracked
    -- lines with no stock to restore: without it booking ships refunded
    -- units at the original quantity.
    SELECT count(*) INTO v_refunded_total
    FROM private.uba_redvault_refund_line_allocations AS allocation
    JOIN private.uba_redvault_refunds AS refund ON refund.id = allocation.refund_id
    WHERE allocation.order_item_id = v_item.id
      AND refund.attempt_id = v_attempt.id
      AND refund.state = 'processed';
    v_surviving := GREATEST(v_item.quantity - v_refunded_total, 0);
    UPDATE public.order_items
    SET fulfillment_data = COALESCE(fulfillment_data, '{}'::jsonb)
      || jsonb_build_object('fulfillmentQuantity', v_surviving)
    WHERE id = v_item.id;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'refundId', p_refund_id, 'restockedCount', v_restocked,
    'quantityLines', v_quantity_lines);
END;
$$;
ALTER FUNCTION private.release_redvault_refund_quantity_units(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.release_redvault_refund_quantity_units(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.release_redvault_refund_inventory_units(p_refund_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_refund private.uba_redvault_refunds%ROWTYPE;
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_request record;
  v_unit record;
  v_item public.order_items%ROWTYPE;
  v_unit_ids uuid[];
  v_count integer := 0;
  v_units_json jsonb;
  v_fulfillment_data jsonb;
BEGIN
  SELECT * INTO STRICT v_refund FROM private.uba_redvault_refunds WHERE id = p_refund_id;
  SELECT * INTO STRICT v_attempt FROM private.uba_redvault_payment_attempts WHERE id = v_refund.attempt_id;
  SELECT * INTO STRICT v_order FROM public.orders WHERE id = v_attempt.order_id FOR UPDATE;
  IF v_refund.state <> 'processed' OR v_refund.refund_type <> 'merchandise_units'
    OR v_order.shipping_status NOT IN ('pending', 'processing') OR v_order.cancelled_at IS NOT NULL
    OR v_order.shipment_id IS NOT NULL OR v_order.tracking_number IS NOT NULL
    OR v_order.shipped_at IS NOT NULL OR v_order.delivered_at IS NOT NULL
    OR v_order.shipment_booking_lock_token IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.shipments WHERE order_id = v_order.id) THEN
    RAISE EXCEPTION 'redvault_partial_refund_inventory_requires_review';
  END IF;
  FOR v_request IN
    SELECT allocation.order_item_id, count(*)::integer AS requested_count
    FROM private.uba_redvault_refund_line_allocations AS allocation
    WHERE allocation.refund_id = p_refund_id
    GROUP BY allocation.order_item_id
  LOOP
    SELECT * INTO STRICT v_item FROM public.order_items WHERE id = v_request.order_item_id
      AND order_id = v_order.id FOR UPDATE;
    -- Non-serialized lines resolve through the quantity path (callers run
    -- release_redvault_refund_quantity_units first); skipping here lets
    -- mixed carts release their serialized remainder instead of stranding
    -- the whole refund in review.
    IF NOT EXISTS (
      SELECT 1 FROM public.products AS product
      LEFT JOIN public.product_variants AS variant ON variant.id = v_item.variant_id
      WHERE product.id = v_item.product_id
        AND product.inventory_tracking_policy = 'serialized_strict'
        AND (v_item.variant_id IS NULL OR COALESCE(variant.inventory_tracking_policy, 'inherit')
          IN ('inherit', 'serialized_strict'))
    ) THEN CONTINUE; END IF;
    SELECT array_agg(unit_id) INTO v_unit_ids FROM (
      SELECT inventory.id AS unit_id
      FROM public.variant_inventory AS inventory
      WHERE inventory.merchant_id = v_order.merchant_id AND inventory.order_id = v_order.id
        AND inventory.order_item_id = v_item.id AND inventory.status = 'reserved'
        AND inventory.sold_at IS NULL
      ORDER BY inventory.id
      LIMIT v_request.requested_count
      FOR UPDATE
    ) AS selected_units;
    IF COALESCE(cardinality(v_unit_ids), 0) <> v_request.requested_count THEN
      RAISE EXCEPTION 'redvault_partial_refund_inventory_requires_review';
    END IF;
    FOR v_unit IN
      SELECT inventory.id, inventory.variant_id, inventory.branch_id, variant.product_id
      FROM public.variant_inventory AS inventory
      JOIN public.product_variants AS variant ON variant.id = inventory.variant_id
      WHERE inventory.id = ANY(v_unit_ids)
      ORDER BY inventory.id
    LOOP
      PERFORM private.record_variant_inventory_event(v_unit.id, v_order.merchant_id, v_unit.product_id,
        v_unit.variant_id, 'reservation_released', 'reserved', 'available', v_order.id, v_item.id,
        v_unit.branch_id, NULL, NULL, jsonb_build_object('redvaultRefundId', p_refund_id));
      UPDATE public.variant_inventory SET status = 'available', order_id = NULL, order_item_id = NULL,
        reserved_at = NULL, reservation_expires_at = NULL, updated_at = now() WHERE id = v_unit.id;
      v_count := v_count + 1;
    END LOOP;
    SELECT jsonb_agg(jsonb_build_object('inventoryUnitId', inventory.id,
      'identifierType', inventory.identifier_type, 'identifierValue', inventory.identifier_value))
      INTO v_units_json FROM public.variant_inventory AS inventory WHERE inventory.order_item_id = v_item.id;
    v_fulfillment_data := jsonb_build_object('source', 'merchant_stock', 'reservationExpiresAt', NULL,
      'inventoryUnits', COALESCE(v_units_json, '[]'::jsonb), 'missingUnitCount',
      GREATEST(v_item.quantity - (SELECT count(*) FROM public.variant_inventory AS inventory
        WHERE inventory.order_item_id = v_item.id AND inventory.status = 'reserved'), 0),
      'fulfillmentQuantity', (SELECT count(*) FROM public.variant_inventory AS inventory
        WHERE inventory.order_item_id = v_item.id AND inventory.status = 'reserved'));
    UPDATE public.order_items SET fulfillment_data = v_fulfillment_data WHERE id = v_item.id;
    PERFORM private.sync_serialized_stock(v_order.merchant_id, v_item.product_id);
  END LOOP;
  IF v_count = 0 THEN RAISE EXCEPTION 'redvault_partial_refund_inventory_requires_review'; END IF;
  RETURN jsonb_build_object('success', true, 'refundId', p_refund_id, 'releasedCount', v_count);
END;
$$;
ALTER FUNCTION private.release_redvault_refund_inventory_units(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.release_redvault_refund_inventory_units(uuid) FROM PUBLIC, anon, authenticated, service_role;

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
    -- quantity-managed stock restocks, then serialized units release.
    -- Release-only would report success with zero units for a
    -- manage_stock order while its decremented stock stays unrestored.
    PERFORM private.restock_order_items(v_order.id);
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

CREATE OR REPLACE FUNCTION private.finalize_redvault_processed_refund()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_quantity_receipt jsonb;
  v_order public.orders%ROWTYPE;
  v_transaction public.transactions%ROWTYPE;
  v_receipt jsonb;
  v_financial_state text := 'review_required';
  v_inventory_state text := 'review_required';
  v_reason text := 'partial_units_require_fulfillment_reconciliation';
  v_had_context boolean;
  v_is_full_refund boolean;
BEGIN
  IF NEW.state <> 'processed' OR EXISTS (
    SELECT 1 FROM private.uba_redvault_refund_lifecycle WHERE refund_id = NEW.id
  ) THEN RETURN NEW; END IF;
  SELECT * INTO STRICT v_attempt FROM private.uba_redvault_payment_attempts WHERE id = NEW.attempt_id;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('baci_order_payment:' || v_attempt.order_id::text, 0));
  v_is_full_refund := (SELECT sum(amount_kobo) FROM private.uba_redvault_refunds
    WHERE attempt_id = v_attempt.id AND state = 'processed') = v_attempt.amount_kobo;
  SELECT * INTO STRICT v_order FROM public.orders WHERE id = v_attempt.order_id FOR UPDATE;
  IF v_is_full_refund AND (SELECT count(*) FROM public.transactions WHERE order_id = v_attempt.order_id
    AND merchant_id = v_attempt.merchant_id AND gateway = 'paystack' AND gateway_reference = v_attempt.reference
    AND transaction_type = 'payment') = 1 THEN
    SELECT * INTO v_transaction FROM public.transactions WHERE order_id = v_attempt.order_id
      AND merchant_id = v_attempt.merchant_id AND gateway = 'paystack' AND gateway_reference = v_attempt.reference
      AND transaction_type = 'payment' FOR UPDATE;
    IF v_order.merchant_id = v_attempt.merchant_id AND v_order.payment_method = 'uba_redvault'
      AND round(v_transaction.amount * 100)::bigint = v_attempt.amount_kobo
      AND upper(v_transaction.currency) = v_attempt.currency AND v_transaction.status IN ('pending', 'completed', 'refunded')
      AND v_order.payment_status IN ('unpaid', 'paid', 'refunded') THEN
      SELECT EXISTS (SELECT 1 FROM private.uba_redvault_write_context
        WHERE transaction_id = pg_catalog.txid_current()) INTO v_had_context;
      INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current()) ON CONFLICT DO NOTHING;
      UPDATE public.transactions SET status = 'refunded', updated_at = now() WHERE id = v_transaction.id;
      UPDATE public.orders SET payment_status = 'refunded', updated_at = now() WHERE id = v_order.id;
      v_financial_state := 'refunded';
      IF v_order.shipping_status IN ('pending', 'processing') AND v_order.cancelled_at IS NULL
        AND v_order.shipment_id IS NULL AND v_order.tracking_number IS NULL AND v_order.shipped_at IS NULL
        AND v_order.delivered_at IS NULL AND v_order.shipment_booking_lock_token IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.shipments WHERE order_id = v_order.id)
        AND EXISTS (SELECT 1 FROM public.order_items WHERE order_id = v_order.id)
        AND NOT EXISTS (SELECT 1 FROM public.order_items AS item LEFT JOIN public.products AS product ON product.id = item.product_id
          LEFT JOIN public.product_variants AS variant ON variant.id = item.variant_id WHERE item.order_id = v_order.id
          AND (product.inventory_tracking_policy IS DISTINCT FROM 'serialized_strict' OR (item.variant_id IS NOT NULL
            AND (variant.id IS NULL OR COALESCE(variant.inventory_tracking_policy, 'inherit') NOT IN ('inherit', 'serialized_strict')))))
        AND NOT EXISTS (SELECT 1 FROM public.variant_inventory WHERE order_id = v_order.id AND sold_at IS NOT NULL) THEN
        BEGIN
          v_receipt := private.release_order_inventory_units(v_order.merchant_id, v_order.id, 'available');
          IF (v_receipt->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'redvault_refund_inventory_release_failed'; END IF;
          v_inventory_state := 'released'; v_reason := NULL;
        EXCEPTION WHEN OTHERS THEN v_receipt := NULL; v_reason := 'inventory_release_requires_review'; END;
      END IF;
      IF NOT v_had_context THEN DELETE FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current(); END IF;
    ELSE v_reason := 'full_capture_financial_state_requires_review'; END IF;
  ELSIF NOT v_is_full_refund AND NEW.refund_type = 'merchandise_units' THEN
    BEGIN
      -- Same dispatch as the review resolver: quantity-managed lines
      -- resolve through the quantity path (the units helper rejects any
      -- non-serialized line), then the serialized remainder (if any)
      -- releases unit-by-unit. A serialized failure rolls the restock
      -- back with it via this block's savepoint, so the resolver later
      -- reconciles from a clean state instead of double-restocking.
      v_quantity_receipt := private.release_redvault_refund_quantity_units(NEW.id);
      IF EXISTS (
        SELECT 1 FROM private.uba_redvault_refund_line_allocations AS allocation
        JOIN public.order_items AS item ON item.id = allocation.order_item_id
        JOIN public.products AS product ON product.id = item.product_id
        LEFT JOIN public.product_variants AS variant ON variant.id = item.variant_id
        WHERE allocation.refund_id = NEW.id
          AND product.inventory_tracking_policy = 'serialized_strict'
          AND (item.variant_id IS NULL OR COALESCE(variant.inventory_tracking_policy, 'inherit')
            IN ('inherit', 'serialized_strict'))
      ) THEN
        v_receipt := private.release_redvault_refund_inventory_units(NEW.id);
        IF (v_receipt->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'redvault_refund_inventory_release_failed'; END IF;
        v_receipt := v_receipt || jsonb_build_object(
          'restockedCount', COALESCE((v_quantity_receipt->>'restockedCount')::integer, 0));
      ELSE
        v_receipt := v_quantity_receipt;
      END IF;
      v_inventory_state := 'released'; v_reason := NULL;
    EXCEPTION WHEN OTHERS THEN v_receipt := NULL; v_reason := 'partial_units_require_fulfillment_reconciliation'; END;
  ELSIF v_is_full_refund THEN v_reason := 'full_capture_transaction_requires_review'; END IF;
  INSERT INTO private.uba_redvault_refund_lifecycle(refund_id, order_id, financial_state, inventory_state, review_reason, inventory_receipt)
  VALUES (NEW.id, v_attempt.order_id, v_financial_state, v_inventory_state, v_reason, v_receipt);
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.finalize_redvault_processed_refund() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.finalize_redvault_processed_refund() FROM PUBLIC, anon, authenticated, service_role;
