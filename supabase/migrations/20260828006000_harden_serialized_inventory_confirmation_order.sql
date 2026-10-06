-- Serialize confirmation's order-item row locks in the same product/id order
-- for every caller. Without a stable order, two multi-item confirmations can
-- lock the same order_items rows in opposite directions and deadlock.
CREATE OR REPLACE FUNCTION private.confirm_order_inventory_reservations(
  p_merchant_id uuid,
  p_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order record;
  v_is_confirmed_hold boolean := false;
  v_item record;
  v_units_json jsonb;
  v_max_expires timestamp with time zone;
  v_reclaimed_count integer := 0;
  v_confirmed_count integer := 0;
  v_already_confirmed_count integer := 0;
  v_total_missing_count integer := 0;
  v_exceptions jsonb := '[]'::jsonb;
  v_total_items integer;
  v_total_qty integer;
  v_has_variants boolean;
  v_variant_model text;
  v_prod_policy text;
  v_anchor_id uuid;
  v_var_policy text;
  v_effective_policy text;
  v_reserved_count integer;
  v_needed integer;
  v_claimed_in_loop integer;
  v_unit record;
  v_unit_branch_id uuid;
  v_fulfillment_data jsonb;
  v_actual_variant_id uuid;
BEGIN
  SELECT payment_status, payment_method, branch_id INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND merchant_id = p_merchant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_order.payment_status IN ('paid', 'bnpl_approved')
     OR (lower(trim(v_order.payment_method)) IN ('pod', 'pay_on_delivery') AND v_order.payment_status = 'pending') THEN
    v_is_confirmed_hold := true;
  END IF;

  IF NOT v_is_confirmed_hold THEN
    RAISE EXCEPTION 'order_not_confirmed_for_inventory_hold' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN
    SELECT oi.*
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
    ORDER BY oi.product_id, oi.id
    FOR UPDATE
  LOOP
    SELECT has_variants, variant_model, inventory_tracking_policy, inventory_anchor_variant_id
    INTO v_has_variants, v_variant_model, v_prod_policy, v_anchor_id
    FROM public.products
    WHERE id = v_item.product_id AND merchant_id = p_merchant_id;

    v_actual_variant_id := v_item.variant_id;
    IF (v_has_variants IS DISTINCT FROM TRUE AND COALESCE(v_variant_model, 'legacy') <> 'sku_matrix') THEN
      PERFORM private.ensure_product_inventory_anchor_variant(p_merchant_id, v_item.product_id);
      SELECT inventory_anchor_variant_id INTO v_actual_variant_id
      FROM public.products
      WHERE id = v_item.product_id;
    END IF;

    SELECT inventory_tracking_policy INTO v_var_policy
    FROM public.product_variants
    WHERE id = v_actual_variant_id AND merchant_id = p_merchant_id;

    v_effective_policy := COALESCE(NULLIF(v_var_policy, 'inherit'), v_prod_policy, 'off');

    IF v_effective_policy = 'off' THEN
      CONTINUE;
    END IF;

    SELECT count(*)::integer INTO v_reserved_count
    FROM public.variant_inventory
    WHERE order_item_id = v_item.id;

    SELECT count(*)::integer INTO v_already_confirmed_count
    FROM public.variant_inventory
    WHERE order_item_id = v_item.id AND reservation_expires_at IS NULL;

    IF v_reserved_count = v_item.quantity THEN
      UPDATE public.variant_inventory
      SET reservation_expires_at = NULL,
          updated_at = now()
      WHERE order_item_id = v_item.id AND reservation_expires_at IS NOT NULL;

      FOR v_unit IN
        SELECT id FROM public.variant_inventory
        WHERE order_item_id = v_item.id AND status = 'reserved'
      LOOP
        PERFORM private.record_variant_inventory_event(
          v_unit.id, p_merchant_id, v_item.product_id, v_actual_variant_id, 'hold_confirmed',
          'reserved', 'reserved', p_order_id, v_item.id, v_order.branch_id, NULL, NULL,
          jsonb_build_object()
        );
        v_confirmed_count := v_confirmed_count + 1;
      END LOOP;
    ELSE
      UPDATE public.variant_inventory
      SET reservation_expires_at = NULL,
          updated_at = now()
      WHERE order_item_id = v_item.id;

      v_needed := v_item.quantity - v_reserved_count;
      v_claimed_in_loop := 0;

      FOR v_unit IN
        SELECT vi.id, vi.branch_id
        FROM public.variant_inventory vi
        WHERE vi.merchant_id = p_merchant_id
          AND vi.variant_id = v_actual_variant_id
          AND vi.status = 'available'
          AND vi.order_id IS NULL
          AND vi.order_item_id IS NULL
          AND vi.sold_at IS NULL
          AND (
            (v_order.branch_id IS NULL AND vi.branch_id IS NULL)
            OR (v_order.branch_id IS NOT NULL AND (vi.branch_id = v_order.branch_id OR vi.branch_id IS NULL))
          )
        ORDER BY (CASE WHEN vi.branch_id = v_order.branch_id THEN 0 ELSE 1 END) ASC, vi.created_at ASC, vi.id ASC
        LIMIT v_needed
        FOR UPDATE SKIP LOCKED
      LOOP
        v_unit_branch_id := COALESCE(v_unit.branch_id, v_order.branch_id);

        UPDATE public.variant_inventory
        SET status = 'reserved',
            order_id = p_order_id,
            order_item_id = v_item.id,
            branch_id = v_unit_branch_id,
            reserved_at = now(),
            first_reserved_at = COALESCE(first_reserved_at, now()),
            reservation_expires_at = NULL,
            updated_at = now()
        WHERE id = v_unit.id;

        PERFORM private.record_variant_inventory_event(
          v_unit.id, p_merchant_id, v_item.product_id, v_actual_variant_id, 'hold_confirmed',
          'available', 'reserved', p_order_id, v_item.id, v_unit_branch_id, NULL, NULL,
          jsonb_build_object('action', 'reclaimed_on_payment')
        );

        v_claimed_in_loop := v_claimed_in_loop + 1;
        v_reclaimed_count := v_reclaimed_count + 1;
      END LOOP;

      IF (v_reserved_count + v_claimed_in_loop) < v_item.quantity THEN
        v_total_missing_count := v_total_missing_count + (v_item.quantity - (v_reserved_count + v_claimed_in_loop));

        IF v_effective_policy = 'serialized_strict' THEN
          v_exceptions := v_exceptions || jsonb_build_object(
            'itemId', v_item.id,
            'code', 'late_payment_reservation_lost'
          );
        END IF;
      END IF;
    END IF;

    SELECT jsonb_agg(
      jsonb_build_object(
        'inventoryUnitId', vi.id,
        'identifierType', vi.identifier_type,
        'identifierValue', vi.identifier_value
      )
    ) INTO v_units_json
    FROM public.variant_inventory vi
    WHERE vi.order_item_id = v_item.id;

    SELECT count(*)::integer INTO v_reserved_count
    FROM public.variant_inventory
    WHERE order_item_id = v_item.id;

    v_fulfillment_data := jsonb_build_object(
      'source', 'merchant_stock',
      'reservationExpiresAt', null,
      'inventoryUnits', COALESCE(v_units_json, '[]'::jsonb),
      'missingUnitCount', GREATEST(v_item.quantity - v_reserved_count, 0)
    );

    IF v_effective_policy = 'serialized_strict' AND v_reserved_count < v_item.quantity THEN
      v_fulfillment_data := jsonb_set(
        v_fulfillment_data,
        '{serializedInventoryException}',
        jsonb_build_object('code', 'late_payment_reservation_lost')
      );
    END IF;

    UPDATE public.order_items
    SET fulfillment_data = v_fulfillment_data
    WHERE id = v_item.id;

    PERFORM private.sync_serialized_stock(p_merchant_id, v_item.product_id);
  END LOOP;

  SELECT count(*), sum(quantity) INTO v_total_items, v_total_qty FROM public.order_items WHERE order_id = p_order_id;
  IF v_total_items = 1 AND v_total_qty = 1 THEN
    SELECT fulfillment_data INTO v_fulfillment_data FROM public.order_items WHERE order_id = p_order_id LIMIT 1;
    UPDATE public.orders SET fulfillment_details = v_fulfillment_data WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object(
    'alreadyConfirmed', v_already_confirmed_count,
    'confirmedUnitCount', v_confirmed_count,
    'reclaimedUnitCount', v_reclaimed_count,
    'missingUnitCount', v_total_missing_count,
    'exceptionCodes', v_exceptions
  );
END;

$$;
