CREATE OR REPLACE FUNCTION public.decrement_product_stock(
  product_id_param uuid,
  quantity_param integer
) RETURNS TABLE(success boolean, new_stock integer, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_stock integer;
  updated_stock integer;
  v_manage_stock boolean;
  v_merchant_id uuid;
BEGIN
  IF product_id_param IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 'Product ID cannot be null'::text;
    RETURN;
  END IF;
  IF quantity_param <= 0 THEN
    RETURN QUERY SELECT FALSE, 0, 'Quantity must be positive'::text;
    RETURN;
  END IF;

  SELECT p.merchant_id, p.manage_stock INTO v_merchant_id, v_manage_stock
  FROM public.products AS p
  WHERE p.id = product_id_param;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 0, 'Product not found'::text;
    RETURN;
  END IF;
  IF COALESCE((SELECT auth.role()), '') <> 'service_role'
    AND NOT public.has_merchant_access(v_merchant_id) THEN
    RETURN QUERY SELECT FALSE, NULL::integer, 'Not authorized'::text;
    RETURN;
  END IF;
  IF NOT COALESCE(v_manage_stock, false) THEN
    RETURN QUERY SELECT TRUE, NULL::integer, 'Stock management disabled - unlimited stock'::text;
    RETURN;
  END IF;

  SELECT p.stock_quantity INTO current_stock
  FROM public.products AS p
  WHERE p.id = product_id_param
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 0, 'Product not found'::text;
    RETURN;
  END IF;
  IF current_stock < quantity_param THEN
    RETURN QUERY SELECT FALSE, current_stock, 'Insufficient stock'::text;
    RETURN;
  END IF;

  UPDATE public.products AS p
  SET stock_quantity = p.stock_quantity - quantity_param,
      updated_at = pg_catalog.clock_timestamp()
  WHERE p.id = product_id_param
  RETURNING p.stock_quantity INTO updated_stock;
  RETURN QUERY SELECT TRUE, updated_stock, 'Stock updated successfully'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.decrement_variant_stock(
  variant_id_param uuid,
  quantity_param integer
) RETURNS TABLE(success boolean, new_stock integer, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_stock integer;
  updated_stock integer;
  v_manage_stock boolean;
  v_merchant_id uuid;
BEGIN
  IF variant_id_param IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 'Variant ID cannot be null'::text;
    RETURN;
  END IF;
  IF quantity_param <= 0 THEN
    RETURN QUERY SELECT FALSE, 0, 'Quantity must be positive'::text;
    RETURN;
  END IF;

  SELECT p.merchant_id, p.manage_stock INTO v_merchant_id, v_manage_stock
  FROM public.products AS p
  JOIN public.product_variants AS pv ON pv.product_id = p.id
  WHERE pv.id = variant_id_param;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 0, 'Variant not found'::text;
    RETURN;
  END IF;
  IF COALESCE((SELECT auth.role()), '') <> 'service_role'
    AND NOT public.has_merchant_access(v_merchant_id) THEN
    RETURN QUERY SELECT FALSE, NULL::integer, 'Not authorized'::text;
    RETURN;
  END IF;
  IF NOT COALESCE(v_manage_stock, false) THEN
    RETURN QUERY SELECT TRUE, NULL::integer, 'Stock management disabled - unlimited stock'::text;
    RETURN;
  END IF;

  SELECT pv.stock_quantity INTO current_stock
  FROM public.product_variants AS pv
  WHERE pv.id = variant_id_param
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 0, 'Variant not found'::text;
    RETURN;
  END IF;
  IF current_stock < quantity_param THEN
    RETURN QUERY SELECT FALSE, current_stock, 'Insufficient stock'::text;
    RETURN;
  END IF;

  UPDATE public.product_variants AS pv
  SET stock_quantity = pv.stock_quantity - quantity_param,
      updated_at = pg_catalog.clock_timestamp()
  WHERE pv.id = variant_id_param
  RETURNING pv.stock_quantity INTO updated_stock;
  RETURN QUERY SELECT TRUE, updated_stock, 'Stock updated successfully'::text;
END;
$$;
