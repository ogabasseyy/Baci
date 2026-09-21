-- Round-31 review fixes.
-- P1 (order-time policy): refund release routing follows reservation
-- reality instead of the mutable catalog policy. A line serialized at
-- order time keeps its unit reservations even if the merchant later
-- flips the policy to off; routing it to the quantity path would
-- restock stock while stranding the reserved units. The quantity path
-- now runs unless the line is BOTH historically and currently
-- serialized, and the unit path runs for every historically
-- serialized line, so flipped lines release through both.
-- P1 (cancel restock): the REDVAULT cancellation trigger already
-- releases serialized units and syncs stock from them, so the
-- explicit cancel restock now covers quantity-managed lines only.
-- The exclusion keys on the CURRENT policy to match the sync.
-- P1 (financial review): resolving inventory no longer closes the
-- shared reconciliation review while a full_capture-flavored
-- financial reconciliation is unresolved, and the financial reason
-- survives inventory release so later resolutions cannot bury it.
-- P2 (reserve deadlock): reservation takes the order advisory lock
-- before locking the attempt row, matching approval's order.
-- Order-time serialization probe for refund release routing: true
-- when units were ever reserved against this order line, whether
-- still linked (live variant_inventory rows) or already released
-- (release nulls the link, but the original 'reserved' events
-- persist). Every order-linked reservation records its event
-- through the canonical reconcile path, so the absence of both
-- means the line was never serialized. SECURITY DEFINER because
-- callers run with the caller's grants on some paths.
CREATE OR REPLACE FUNCTION private.redvault_line_was_serialized(p_order_id uuid, p_order_item_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.variant_inventory AS inventory
    WHERE inventory.order_id = p_order_id AND inventory.order_item_id = p_order_item_id
  ) OR EXISTS (
    SELECT 1 FROM private.variant_inventory_events AS event
    WHERE event.order_id = p_order_id AND event.order_item_id = p_order_item_id
      AND event.event_type = 'reserved'
  );
$$;
ALTER FUNCTION private.redvault_line_was_serialized(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.redvault_line_was_serialized(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
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
    -- Routing follows reservation reality, not the mutable catalog
    -- policy: a line serialized at order time keeps its unit
    -- reservations even if the merchant later flips the policy to
    -- off, while the stock sync only touches currently-serialized
    -- products. The quantity path therefore runs unless the line is
    -- BOTH historically and currently serialized (unit release plus
    -- stock sync own that case): flipped lines still need this
    -- restock, and never-serialized lines are unaffected either way.
    IF private.redvault_line_was_serialized(v_order.id, v_request.order_item_id)
      AND EXISTS (
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
    -- The historical predicate mirrors the quantity helper: a line
    -- whose policy flipped to off after order time still holds its
    -- unit reservations, and skipping it by current policy would
    -- strand those units while the lifecycle releases.
    IF NOT private.redvault_line_was_serialized(v_order.id, v_request.order_item_id)
    THEN CONTINUE; END IF;
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
        WHERE allocation.refund_id = NEW.id
          AND private.redvault_line_was_serialized(v_order.id, allocation.order_item_id)
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
-- Cancellation restock limited to quantity-managed lines. The
-- REDVAULT cancellation trigger releases serialized units and syncs
-- stock from the now-available units before this runs, so including
-- serialized lines would double-count their quantities. The
-- exclusion is NULL-safe (an unset policy is quantity-managed) and
-- keys on the CURRENT policy to match the sync, which only touches
-- currently-serialized products.
CREATE OR REPLACE FUNCTION private.restock_order_items_excluding_serialized(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.product_variants v
  SET stock_quantity = v.stock_quantity + agg.qty
  FROM (
    SELECT oi.variant_id AS variant_id, SUM(oi.quantity)::int AS qty
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
    LEFT JOIN public.product_variants AS variant ON variant.id = oi.variant_id
    WHERE oi.order_id = p_order_id
      AND oi.variant_id IS NOT NULL
      AND COALESCE(p.manage_stock, false) = true
      AND (p.inventory_tracking_policy IS DISTINCT FROM 'serialized_strict'
        OR COALESCE(variant.inventory_tracking_policy, 'inherit')
          NOT IN ('inherit', 'serialized_strict'))
    GROUP BY oi.variant_id
  ) agg
  WHERE v.id = agg.variant_id;

  UPDATE public.products p
  SET stock_quantity = COALESCE(p.stock_quantity, 0) + agg.qty
  FROM (
    SELECT oi.product_id AS product_id, SUM(oi.quantity)::int AS qty
    FROM public.order_items oi
    JOIN public.products pp ON pp.id = oi.product_id
    WHERE oi.order_id = p_order_id
      AND oi.variant_id IS NULL
      AND oi.product_id IS NOT NULL
      AND COALESCE(pp.manage_stock, false) = true
      AND pp.inventory_tracking_policy IS DISTINCT FROM 'serialized_strict'
    GROUP BY oi.product_id
  ) agg
  WHERE p.id = agg.product_id;
END;
$$;
ALTER FUNCTION private.restock_order_items_excluding_serialized(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.restock_order_items_excluding_serialized(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
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
  -- on ordinary cancellation. Serialized lines are excluded: the
  -- payment_status trigger already released their units and synced
  -- stock from the now-available units, so restocking them again
  -- would double-count the original quantities into sellable stock.
  -- The exclusion keys on the CURRENT policy to match the sync,
  -- which only touches currently-serialized products.
  PERFORM private.restock_order_items_excluding_serialized(p_order_id);

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
  -- on ordinary cancellation. Serialized lines are excluded: the
  -- payment_status trigger already released their units and synced
  -- stock from the now-available units, so restocking them again
  -- would double-count the original quantities into sellable stock.
  -- The exclusion keys on the CURRENT policy to match the sync,
  -- which only touches currently-serialized products.
    PERFORM private.restock_order_items_excluding_serialized(p_order_id);

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
      WHERE allocation.refund_id = p_refund_id
        AND private.redvault_line_was_serialized(v_lifecycle.order_id, allocation.order_item_id)
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
  -- A full_capture-flavored financial reason survives inventory
  -- release: it is the only marker that local finance never
  -- reconciled, and clearing it would let a later resolution close
  -- the shared review while the order is still paid.
  UPDATE private.uba_redvault_refund_lifecycle
  SET inventory_state = 'released',
      review_reason = CASE
        WHEN financial_state = 'review_required' AND review_reason LIKE 'full_capture%' THEN review_reason
        ELSE NULL END,
      inventory_receipt = v_result
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
    )
    -- The shared review also covers financial reconciliation: a full
    -- refund whose payment transaction could not be matched leaves
    -- financial_state = 'review_required' with the order still paid
    -- while the provider refunded. That row (this refund or an
    -- earlier one) holds the review open until finance is explicitly
    -- reconciled. Merchandise partials never reconcile local finance
    -- by design, so only full_capture-flavored reasons block
    -- closure. No self-exclusion: this resolver never touches
    -- financial_state, so an unresolved self must also block.
    AND NOT EXISTS (
      SELECT 1 FROM private.uba_redvault_refund_lifecycle AS blocked
      WHERE blocked.order_id = v_lifecycle.order_id
        AND blocked.financial_state = 'review_required'
        AND blocked.review_reason LIKE 'full_capture%'
    );
  RETURN v_result || jsonb_build_object('inventoryState', 'released');
END;
$$;
ALTER FUNCTION public.resolve_uba_redvault_refund_inventory_review(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_uba_redvault_refund_inventory_review(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_uba_redvault_refund_inventory_review(uuid)
  TO service_role;
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
  v_order_id uuid;
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
  -- Read the order id WITHOUT locking first: approval
  -- (approve_and_complete_uba_redvault_payment) takes the order
  -- advisory lock before locking the attempt row, so locking the
  -- attempt first here deadlocks when approval and reservation race.
  -- The advisory lock is acquired before any row lock, and the
  -- attempt is then locked and fully revalidated below.
  SELECT attempt.order_id INTO v_order_id FROM private.uba_redvault_payment_attempts AS attempt
    WHERE attempt.id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'redvault_refund_attempt_not_found';
  END IF;
  IF v_order_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('baci_order_payment:' || v_order_id::text, 0)
    );
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
  -- The order advisory lock above (taken before any row lock) keeps
  -- this reservation serialized against the shipment-booking claim,
  -- which holds the same lock while checking for refunds: whichever
  -- commits first is visible to the other's check (pending refund
  -- row vs lock token) and exactly one proceeds.
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
