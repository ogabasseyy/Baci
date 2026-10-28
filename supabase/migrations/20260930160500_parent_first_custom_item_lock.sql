-- Item-first writers must lock the parent order before touching items:
-- manual document dispatch takes (order FOR SHARE, then children), so an
-- item-then-order writer deadlocks against it (mobile admin's custom-item
-- path updates order_items first; the tax trigger then updates the order).
-- Locking the order first keeps every writer on the staff-edit order.
CREATE OR REPLACE FUNCTION public.mark_transaction_order_item_custom(
  p_merchant_id uuid,
  p_order_item_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows integer;
  v_order_id uuid;
BEGIN
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Merchant is required' USING ERRCODE = '22023';
  END IF;

  IF p_order_item_id IS NULL THEN
    RAISE EXCEPTION 'Transaction line item is required'
      USING ERRCODE = '22023';
  END IF;

  -- Mirror the UPDATE predicates below so the parent lock is taken only
  -- when the update will succeed; every failure mode still raises the
  -- same P0001 below without holding a lock.
  SELECT oi.order_id INTO v_order_id
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE oi.id = p_order_item_id
    AND o.merchant_id = p_merchant_id
    AND oi.product_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Could not mark this item custom for this merchant'
      USING ERRCODE = 'P0001';
  END IF;

  -- Parent-first: serialize against dispatch's order FOR SHARE before the
  -- item UPDATE below (and the tax trigger's order UPDATE after it).
  PERFORM 1 FROM public.orders o
  WHERE o.id = v_order_id
  FOR UPDATE;

  UPDATE public.order_items oi
  SET product_match_status = 'custom'
  FROM public.orders o
  WHERE oi.id = p_order_item_id
    AND oi.order_id = o.id
    AND o.merchant_id = p_merchant_id
    AND oi.product_id IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RAISE EXCEPTION 'Could not mark this item custom for this merchant'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_transaction_order_item_custom(
  uuid,
  uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.mark_transaction_order_item_custom(
  uuid,
  uuid
) TO authenticated;
