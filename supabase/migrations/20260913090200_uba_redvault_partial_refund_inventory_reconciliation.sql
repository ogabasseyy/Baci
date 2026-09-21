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
    IF NOT EXISTS (
      SELECT 1 FROM public.products AS product
      LEFT JOIN public.product_variants AS variant ON variant.id = v_item.variant_id
      WHERE product.id = v_item.product_id
        AND product.inventory_tracking_policy = 'serialized_strict'
        AND (v_item.variant_id IS NULL OR COALESCE(variant.inventory_tracking_policy, 'inherit')
          IN ('inherit', 'serialized_strict'))
    ) THEN RAISE EXCEPTION 'redvault_partial_refund_inventory_requires_review'; END IF;
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

CREATE OR REPLACE FUNCTION private.redvault_approved_completion_durable(p_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.uba_redvault_applications AS application
    JOIN private.uba_redvault_payment_attempts AS attempt ON attempt.application_id = application.id
    WHERE application.order_id = p_order_id AND application.status = 'approved' AND attempt.state = 'approved'
      AND jsonb_typeof(attempt.provider_response->'completion_receipt') = 'object'
      AND jsonb_typeof(attempt.provider_response->'inventory_completion_receipt') = 'object'
      AND attempt.provider_response->'inventory_completion_receipt'->>'inventoryConfirmed' = 'true'
      AND jsonb_typeof(attempt.provider_response->'inventory_completion_receipt'->'inventoryReclaimedUnitCount') = 'number'
      AND attempt.provider_response->'inventory_completion_receipt'->>'inventoryReclaimedUnitCount' ~ '^(0|[1-9][0-9]*)$'
      AND NOT EXISTS (
        SELECT 1 FROM private.uba_redvault_refunds AS refund
        LEFT JOIN private.uba_redvault_refund_lifecycle AS lifecycle ON lifecycle.refund_id = refund.id
        WHERE refund.attempt_id = attempt.id AND (
          refund.state IN ('pending', 'processing') OR (refund.state = 'processed' AND (
            refund.refund_type <> 'merchandise_units' OR lifecycle.inventory_state <> 'released'
          ))
        )
      )
  );
$$;
ALTER FUNCTION private.redvault_approved_completion_durable(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.redvault_approved_completion_durable(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.finalize_redvault_processed_refund()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
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
      v_receipt := private.release_redvault_refund_inventory_units(NEW.id);
      IF (v_receipt->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'redvault_refund_inventory_release_failed'; END IF;
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
