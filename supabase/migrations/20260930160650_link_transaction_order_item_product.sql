-- Align link_transaction_order_item_product with the manual-document
-- dispatch lock order (order, children), split out of
-- 20260930160600_parent_first_review_link_locks (300-line rule): the two
-- RPC replacements are independent definitions, so each migration keeps
-- its own function plus grants.
CREATE OR REPLACE FUNCTION public.link_transaction_order_item_product(
  p_merchant_id uuid,
  p_order_item_id uuid,
  p_product_id uuid,
  p_variant_id uuid
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

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'Product is required' USING ERRCODE = '22023';
  END IF;

  IF p_variant_id IS NULL THEN
    PERFORM 1
    FROM public.products p
    WHERE p.id = p_product_id
      AND p.merchant_id = p_merchant_id;
  ELSE
    PERFORM 1
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
    WHERE v.id = p_variant_id
      AND v.product_id = p_product_id
      AND v.merchant_id = p_merchant_id
      AND p.merchant_id = p_merchant_id;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Could not verify product or variant for this merchant'
      USING ERRCODE = 'P0001';
  END IF;

  -- Parent-first (PR 3580 dispatch): mirror the UPDATE predicates so the
  -- parent lock is taken only when the link will succeed; every failure
  -- mode still raises the same P0001 below without holding a lock.
  SELECT oi.order_id INTO v_order_id
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE oi.id = p_order_item_id
    AND o.merchant_id = p_merchant_id
    AND oi.product_id IS NULL
    AND COALESCE(oi.product_match_status, 'unreviewed') <> 'custom';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Could not link this item to that product for this merchant'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM public.orders o
  WHERE o.id = v_order_id
  FOR UPDATE;

  UPDATE public.order_items oi
  SET
    product_id = p_product_id,
    product_match_status = 'linked',
    variant_id = p_variant_id
  FROM public.orders o
  WHERE oi.id = p_order_item_id
    AND oi.order_id = o.id
    AND o.merchant_id = p_merchant_id
    AND oi.product_id IS NULL
    AND COALESCE(oi.product_match_status, 'unreviewed') <> 'custom';

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RAISE EXCEPTION 'Could not link this item to that product for this merchant'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.link_transaction_order_item_product(
  uuid,
  uuid,
  uuid,
  uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.link_transaction_order_item_product(
  uuid,
  uuid,
  uuid,
  uuid
) TO authenticated;

NOTIFY pgrst, 'reload schema';
