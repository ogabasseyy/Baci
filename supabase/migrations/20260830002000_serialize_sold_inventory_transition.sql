-- Serialize payment-time sale transitions on the same parent order lock used
-- by cancellation/release, then acquire reserved units in a stable order.
-- This prevents cross-product lock inversion between sale and release paths.
CREATE OR REPLACE FUNCTION private.mark_order_inventory_units_sold(
  p_merchant_id uuid,
  p_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_unit record;
  v_count integer := 0;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role'
     AND NOT public.has_merchant_access(p_merchant_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.orders
  WHERE id = p_order_id AND merchant_id = p_merchant_id
  FOR UPDATE;

  FOR v_unit IN
    SELECT vi.id, vi.variant_id, vi.order_item_id, vi.branch_id, pv.product_id
    FROM public.variant_inventory vi
    JOIN public.product_variants pv ON vi.variant_id = pv.id
    WHERE vi.order_id = p_order_id
      AND vi.merchant_id = p_merchant_id
      AND vi.status = 'reserved'
    ORDER BY pv.product_id, vi.id
    FOR UPDATE OF vi
  LOOP
    UPDATE public.variant_inventory
    SET status = 'sold',
        sold_at = now(),
        updated_at = now()
    WHERE id = v_unit.id AND status = 'reserved';

    PERFORM private.record_variant_inventory_event(
      v_unit.id, p_merchant_id, v_unit.product_id, v_unit.variant_id, 'sold',
      'reserved', 'sold', p_order_id, v_unit.order_item_id, v_unit.branch_id, NULL, NULL,
      jsonb_build_object()
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'orderId', p_order_id,
    'unitsMarkedSold', v_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_order_inventory_units_sold(
  p_merchant_id uuid,
  p_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  RETURN private.mark_order_inventory_units_sold(
    p_merchant_id,
    p_order_id
  );
END;
$$;
