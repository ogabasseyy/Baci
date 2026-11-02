-- Fix: three order inventory lifecycle RPCs wrote to public.orders.delivery_address,
-- a column that has never existed. PL/pgSQL only resolves columns at run time, so
-- every call raised 42703 (undefined_column) and rolled back:
--   - private.cancel_order_and_release_inventory (also reached through
--     private.cancel_provider_shipment_order_and_release_inventory and
--     private.release_quiz_prize_reservation_v2)
--   - private.mark_order_payment_failed_and_release_inventory
--   - private.complete_order_shipment_with_inventory
-- The shipping address lives in public.orders.shipping_address (jsonb). The bodies
-- below match the live definitions except for that one column. Parameter names,
-- the `delivery_address` key of p_shipping_update, SECURITY DEFINER, the empty
-- search_path and the existing grants are unchanged.

CREATE OR REPLACE FUNCTION private.cancel_order_and_release_inventory(
  p_merchant_id uuid,
  p_order_id uuid,
  p_payment_status text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_shipping_address jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order record;
  v_released jsonb;
  v_count integer;
BEGIN
  -- 1. Auth check
  IF auth.role() <> 'service_role'
     AND NOT public.has_merchant_access(p_merchant_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- 2. Lock order row
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND merchant_id = p_merchant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Validate current status can transition to cancelled
  IF v_order.shipping_status IN ('cancelled', 'shipped', 'delivered') THEN
    RAISE EXCEPTION 'invalid_order_cancellation_state' USING ERRCODE = '22023';
  END IF;

  -- 3. Release units
  SELECT * INTO v_released FROM private.release_order_inventory_units(p_merchant_id, p_order_id, 'available');
  v_count := (v_released->>'releasedCount')::integer;

  -- 4. Update order status
  UPDATE public.orders
  SET shipping_status = 'cancelled',
      payment_status = COALESCE(p_payment_status, payment_status),
      notes = COALESCE(p_notes, notes),
      shipping_address = COALESCE(p_shipping_address, shipping_address),
      updated_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'orderId', p_order_id,
    'releasedUnitCount', v_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.mark_order_payment_failed_and_release_inventory(
  p_merchant_id uuid,
  p_order_id uuid,
  p_payment_status text,
  p_notes text DEFAULT NULL,
  p_shipping_address jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_released jsonb;
  v_count integer;
BEGIN
  -- 1. Auth check
  IF auth.role() <> 'service_role'
     AND NOT public.has_merchant_access(p_merchant_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Validate target payment status
  IF p_payment_status NOT IN ('failed', 'cancelled', 'abandoned', 'expired') THEN
    RAISE EXCEPTION 'invalid_payment_status' USING ERRCODE = '22023';
  END IF;

  -- 2. Lock and verify order
  PERFORM 1 FROM public.orders
  WHERE id = p_order_id AND merchant_id = p_merchant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Release inventory
  SELECT * INTO v_released FROM private.release_order_inventory_units(p_merchant_id, p_order_id, 'available');
  v_count := (v_released->>'releasedCount')::integer;

  -- 4. Update order status
  UPDATE public.orders
  SET payment_status = p_payment_status,
      notes = COALESCE(p_notes, notes),
      shipping_address = COALESCE(p_shipping_address, shipping_address),
      updated_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'orderId', p_order_id,
    'paymentStatus', p_payment_status,
    'releasedUnitCount', v_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.complete_order_shipment_with_inventory(
  p_merchant_id uuid,
  p_order_id uuid,
  p_external_units jsonb DEFAULT '[]'::jsonb,
  p_shipping_update jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order record;
  v_validation jsonb;
  v_sold_res jsonb;
  v_ext_item jsonb;
  v_idx integer;
  v_item_id uuid;
  v_track_num text;
  v_ship_provider text;
  v_ship_fee numeric;
  v_ship_addr jsonb;
BEGIN
  -- 1. Auth check
  IF auth.role() <> 'service_role'
     AND NOT public.has_merchant_access(p_merchant_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- 2. Lock order row
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND merchant_id = p_merchant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Check if order can transition to shipped
  IF v_order.shipping_status IN ('shipped', 'delivered', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_order_shipping_transition' USING ERRCODE = '22023';
  END IF;

  -- 3. Re-validate inventory under lock
  v_validation := private.validate_order_shipment_inventory(p_merchant_id, p_order_id, p_external_units);

  -- 4. Record external units
  IF p_external_units IS NOT NULL AND jsonb_typeof(p_external_units) = 'array' THEN
    FOR v_idx IN 0 .. jsonb_array_length(p_external_units) - 1 LOOP
      v_ext_item := p_external_units->v_idx;
      v_item_id := (v_ext_item->>'itemId')::uuid;

      PERFORM private.record_external_order_inventory_units(
        p_merchant_id, p_order_id, v_item_id, v_ext_item->'units', 'vendor_sourced'
      );
    END LOOP;
  END IF;

  -- 5. Mark reserved units as sold
  v_sold_res := private.mark_order_inventory_units_sold(p_merchant_id, p_order_id);

  -- 6. Update order shipping status and shipping fields
  v_track_num := p_shipping_update->>'tracking_number';
  v_ship_provider := p_shipping_update->>'shipping_provider';
  v_ship_fee := (p_shipping_update->>'shipping_fee')::numeric;
  v_ship_addr := p_shipping_update->'delivery_address';

  UPDATE public.orders
  SET shipping_status = 'shipped',
      tracking_number = COALESCE(v_track_num, tracking_number),
      shipping_provider = COALESCE(v_ship_provider, shipping_provider),
      shipping_fee = COALESCE(v_ship_fee, shipping_fee),
      shipping_address = COALESCE(v_ship_addr, shipping_address),
      shipped_at = COALESCE(shipped_at, now()),
      updated_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'orderId', p_order_id,
    'soldUnitCount', v_sold_res->'unitsMarkedSold',
    'externalUnitCount', v_validation->'externalUnitCount',
    'shippingStatus', 'shipped'
  );
END;
$$;

-- CREATE OR REPLACE keeps the existing ACLs; restate them so the replayed history
-- and production agree on exactly who may execute these functions.
REVOKE ALL ON FUNCTION private.cancel_order_and_release_inventory(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.cancel_order_and_release_inventory(uuid, uuid, text, text, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION private.mark_order_payment_failed_and_release_inventory(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.mark_order_payment_failed_and_release_inventory(uuid, uuid, text, text, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION private.complete_order_shipment_with_inventory(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.complete_order_shipment_with_inventory(uuid, uuid, jsonb, jsonb) TO authenticated, service_role;
