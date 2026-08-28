CREATE OR REPLACE FUNCTION private.release_order_inventory_units(
  p_merchant_id uuid,
  p_order_id uuid,
  p_target_status text DEFAULT 'available'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target_status text := COALESCE(p_target_status, 'available');
  v_unit record;
  v_count integer := 0;
  v_item record;
  v_units_json jsonb;
  v_fulfillment_data jsonb;
  v_reserved_count integer;
  v_total_items integer;
  v_total_qty integer;
  v_synced_product_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.has_merchant_access(p_merchant_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_target_status NOT IN ('available', 'returned') THEN
    RAISE EXCEPTION 'invalid_target_status' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.orders
  WHERE id = p_order_id AND merchant_id = p_merchant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_target_status = 'available' THEN
    FOR v_unit IN
      SELECT vi.*, pv.product_id
      FROM public.variant_inventory vi
      JOIN public.product_variants pv ON vi.variant_id = pv.id
      WHERE vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id AND vi.status = 'reserved'
      FOR UPDATE OF vi
    LOOP
      PERFORM private.record_variant_inventory_event(
        v_unit.id, p_merchant_id, v_unit.product_id, v_unit.variant_id, 'reservation_released',
        'reserved', 'available', p_order_id, v_unit.order_item_id, v_unit.branch_id, NULL, NULL,
        jsonb_build_object()
      );

      UPDATE public.variant_inventory
      SET status = 'available',
          order_id = NULL,
          order_item_id = NULL,
          reserved_at = NULL,
          reservation_expires_at = NULL,
          updated_at = now()
      WHERE id = v_unit.id;

      v_count := v_count + 1;
    END LOOP;
  ELSE
    FOR v_unit IN
      SELECT vi.*, pv.product_id
      FROM public.variant_inventory vi
      JOIN public.product_variants pv ON vi.variant_id = pv.id
      WHERE vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id AND vi.status = 'reserved'
      FOR UPDATE OF vi
    LOOP
      PERFORM private.record_variant_inventory_event(
        v_unit.id, p_merchant_id, v_unit.product_id, v_unit.variant_id, 'returned',
        'reserved', 'returned', p_order_id, v_unit.order_item_id, v_unit.branch_id, NULL, NULL,
        jsonb_build_object()
      );

      UPDATE public.variant_inventory
      SET status = 'returned',
          updated_at = now()
      WHERE id = v_unit.id;

      v_count := v_count + 1;
    END LOOP;
  END IF;

  FOR v_item IN
    SELECT oi.*
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
    FOR UPDATE
  LOOP
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
    WHERE order_item_id = v_item.id AND status = 'reserved';

    v_fulfillment_data := jsonb_build_object(
      'source', 'merchant_stock',
      'reservationExpiresAt', null,
      'inventoryUnits', COALESCE(v_units_json, '[]'::jsonb),
      'missingUnitCount', GREATEST(v_item.quantity - v_reserved_count, 0)
    );

    UPDATE public.order_items
    SET fulfillment_data = v_fulfillment_data
    WHERE id = v_item.id;

    IF array_position(v_synced_product_ids, v_item.product_id) IS NULL THEN
      PERFORM private.sync_serialized_stock(p_merchant_id, v_item.product_id);
      v_synced_product_ids := array_append(v_synced_product_ids, v_item.product_id);
    END IF;
  END LOOP;

  SELECT count(*), sum(quantity)
  INTO v_total_items, v_total_qty
  FROM public.order_items
  WHERE order_id = p_order_id;

  IF v_total_items = 1 AND v_total_qty = 1 THEN
    SELECT fulfillment_data
    INTO v_fulfillment_data
    FROM public.order_items
    WHERE order_id = p_order_id
    LIMIT 1;

    UPDATE public.orders
    SET fulfillment_details = v_fulfillment_data
    WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'orderId', p_order_id,
    'releasedCount', v_count
  );
END;
$$;
