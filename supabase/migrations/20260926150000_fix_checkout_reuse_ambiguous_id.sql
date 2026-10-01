-- Qualify row ids that otherwise collide with the RETURNS TABLE id variable.
-- Preserve the existing checkout authorization, payment and inventory rules.
CREATE OR REPLACE FUNCTION private.prepare_storefront_order_for_checkout(
  p_order_id UUID,
  p_merchant_id UUID,
  p_tracking_token TEXT,
  p_customer_email TEXT,
  p_payment_method TEXT,
  p_shipping_provider TEXT DEFAULT NULL,
  p_selected_quote_id UUID DEFAULT NULL,
  p_shipping_address JSONB DEFAULT NULL,
  p_has_selected_quote_id BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id UUID,
  order_number TEXT,
  tracking_token TEXT,
  subtotal NUMERIC,
  shipping_fee NUMERIC,
  total NUMERIC,
  currency TEXT,
  payment_method TEXT,
  payment_status TEXT,
  shipping_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order record;
  v_effective_payment_status TEXT;
  v_item record;
  v_has_reserved boolean;
  v_is_pod boolean;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id_required';
  END IF;

  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'merchant_id_required';
  END IF;

  IF p_tracking_token IS NULL OR trim(p_tracking_token) = '' THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_customer_email IS NULL OR trim(p_customer_email) = '' THEN
    RAISE EXCEPTION 'email_required';
  END IF;

  IF p_payment_method IS NULL OR trim(p_payment_method) = '' THEN
    RAISE EXCEPTION 'payment_method_required';
  END IF;

  SELECT
    o.id,
    o.merchant_id,
    o.order_number,
    o.tracking_token,
    o.customer_email,
    o.subtotal,
    o.shipping_fee,
    o.total,
    o.currency,
    o.payment_method,
    o.payment_status,
    o.shipping_status
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF v_order.merchant_id <> p_merchant_id THEN
    RAISE EXCEPTION 'merchant_mismatch';
  END IF;

  IF v_order.tracking_token <> trim(p_tracking_token) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF lower(trim(v_order.customer_email)) <> lower(trim(p_customer_email)) THEN
    RAISE EXCEPTION 'email_mismatch';
  END IF;

  IF v_order.payment_status IN ('paid', 'bnpl_approved', 'refunded') THEN
    RAISE EXCEPTION 'order_not_reusable';
  END IF;

  IF coalesce(v_order.shipping_status, '') IN (
    'processing',
    'shipped',
    'out_for_delivery',
    'delivered',
    'completed',
    'cancelled'
  ) THEN
    RAISE EXCEPTION 'order_not_reusable';
  END IF;

  v_effective_payment_status := CASE
    WHEN p_payment_method IN ('pod', 'pay_on_delivery') THEN 'pending'
    ELSE 'unpaid'
  END;

  IF p_shipping_provider IS NOT NULL AND p_selected_quote_id IS NULL THEN
    RAISE EXCEPTION 'shipping_quote_required';
  END IF;

  UPDATE public.orders o
  SET
    payment_method = trim(p_payment_method),
    payment_status = v_effective_payment_status,
    shipping_status = 'pending',
    shipping_address = COALESCE(p_shipping_address, o.shipping_address),
    shipping_provider = CASE
      WHEN p_has_selected_quote_id THEN p_shipping_provider
      ELSE COALESCE(p_shipping_provider, o.shipping_provider)
    END,
    selected_quote_id = CASE
      WHEN p_has_selected_quote_id THEN p_selected_quote_id
      ELSE COALESCE(p_selected_quote_id, o.selected_quote_id)
    END,
    updated_at = now()
  WHERE o.id = p_order_id;

  v_is_pod := lower(trim(p_payment_method)) IN ('pod', 'pay_on_delivery');

  FOR v_item IN
    SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
    FOR UPDATE
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.variant_inventory
      WHERE order_item_id = v_item.id AND status = 'reserved'
    ) INTO v_has_reserved;

    IF v_has_reserved THEN
      IF v_is_pod THEN
        UPDATE public.variant_inventory
        SET reservation_expires_at = NULL,
            updated_at = now()
        WHERE order_item_id = v_item.id;
      ELSE
        UPDATE public.variant_inventory
        SET reservation_expires_at = now() + interval '2 hours',
            updated_at = now()
        WHERE order_item_id = v_item.id;
      END IF;

      DECLARE
        v_units_json jsonb;
        v_max_expires timestamp with time zone;
        v_reserved_count integer;
      BEGIN
        SELECT jsonb_agg(jsonb_build_object(
          'inventoryUnitId', vi.id,
          'identifierType', vi.identifier_type,
          'identifierValue', vi.identifier_value
        )) INTO v_units_json
        FROM public.variant_inventory vi
        WHERE vi.order_item_id = v_item.id;

        SELECT max(reservation_expires_at) INTO v_max_expires
        FROM public.variant_inventory vi
        WHERE vi.order_item_id = v_item.id;

        SELECT count(*)::integer INTO v_reserved_count
        FROM public.variant_inventory
        WHERE order_item_id = v_item.id;

        UPDATE public.order_items AS oi
        SET fulfillment_data = jsonb_build_object(
          'source', 'merchant_stock',
          'reservationExpiresAt', to_jsonb(v_max_expires),
          'inventoryUnits', COALESCE(v_units_json, '[]'::jsonb),
          'missingUnitCount', GREATEST(v_item.quantity - v_reserved_count, 0)
        )
        WHERE oi.id = v_item.id;
      END;
    ELSE
      PERFORM private.claim_variant_inventory_units_for_order_item_internal(
        p_merchant_id,
        p_order_id,
        v_item.id
      );
    END IF;
  END LOOP;

  DECLARE
    v_total_items integer;
    v_total_qty integer;
    v_fulfillment_data jsonb;
  BEGIN
    SELECT count(*), sum(quantity) INTO v_total_items, v_total_qty FROM public.order_items WHERE order_id = p_order_id;
    IF v_total_items = 1 AND v_total_qty = 1 THEN
      SELECT fulfillment_data INTO v_fulfillment_data FROM public.order_items WHERE order_id = p_order_id LIMIT 1;
      UPDATE public.orders AS o SET fulfillment_details = v_fulfillment_data WHERE o.id = p_order_id;
    END IF;
  END;

  RETURN QUERY
  SELECT
    o.id,
    o.order_number,
    o.tracking_token,
    o.subtotal,
    o.shipping_fee,
    o.total,
    o.currency,
    o.payment_method,
    o.payment_status,
    o.shipping_status
  FROM public.orders o
  WHERE o.id = p_order_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
