-- Private storefront previews use checkout's default branch eligibility and
-- disclose only aggregate counts to the merchant owner or their scoped grant.
CREATE FUNCTION public.experience_owner_serialized_availability_counts(
  p_merchant uuid,
  p_connection uuid,
  p_version bigint,
  p_product_ids uuid[]
)
RETURNS TABLE(product_id uuid, variant_id uuid, public_available_units integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  active_branch_count integer;
  only_active_branch_id uuid;
BEGIN
  PERFORM public.experience_authorize_read(p_merchant, p_connection, p_version);

  IF COALESCE(cardinality(p_product_ids), 0) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::integer, (array_agg(b.id))[1]
  INTO active_branch_count, only_active_branch_id
  FROM public.branches b
  WHERE b.merchant_id = p_merchant AND b.active;

  RETURN QUERY
  SELECT
    p.id,
    CASE WHEN pv.is_inventory_anchor THEN NULL::uuid ELSE pv.id END,
    count(*)::integer
  FROM public.products p
  JOIN public.product_variants pv ON pv.product_id = p.id AND pv.merchant_id = p_merchant
  JOIN public.variant_inventory vi ON vi.variant_id = pv.id AND vi.merchant_id = p_merchant
  WHERE p.merchant_id = p_merchant
    AND p.status = 'active'
    AND p.id = ANY(p_product_ids)
    AND vi.status = 'available'
    AND vi.order_id IS NULL
    AND vi.order_item_id IS NULL
    AND vi.sold_at IS NULL
    AND (vi.branch_id IS NULL OR (active_branch_count = 1 AND vi.branch_id = only_active_branch_id))
  GROUP BY p.id, CASE WHEN pv.is_inventory_anchor THEN NULL::uuid ELSE pv.id END;
END;
$$;

REVOKE ALL ON FUNCTION public.experience_owner_serialized_availability_counts(uuid,uuid,bigint,uuid[])
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.experience_owner_serialized_availability_counts(uuid,uuid,bigint,uuid[])
TO authenticated;
