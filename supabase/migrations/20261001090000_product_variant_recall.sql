-- Merchant-scoped variant attributes for MCP discovery recall. The serving
-- search document never indexes product_variants, and the table's SELECT
-- policy is staff-only, so recall reads through this SECURITY DEFINER
-- function with the same published-merchant eligibility as the feed RPC.
CREATE OR REPLACE FUNCTION public.search_product_variant_recall(
  p_merchant_id uuid,
  p_limit integer DEFAULT 2000
) RETURNS TABLE (product_id uuid, attributes jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT pv.product_id, pv.attributes
  FROM public.product_variants AS pv
  JOIN public.products AS p ON p.id = pv.product_id
  JOIN public.merchants AS m ON m.id = p.merchant_id
  WHERE pv.merchant_id = p_merchant_id
    AND p.merchant_id = p_merchant_id
    AND p.status = 'active'
    AND pv.is_inventory_anchor IS NOT TRUE
    AND (
      COALESCE(m.is_published, FALSE) = TRUE
      OR COALESCE(m.is_platform_admin, FALSE) = TRUE
    )
  ORDER BY pv.product_id, pv.created_at, pv.id
  LIMIT least(greatest(coalesce(p_limit, 2000), 1), 2001);
$$;

ALTER FUNCTION public.search_product_variant_recall(uuid, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.search_product_variant_recall(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_product_variant_recall(uuid, integer) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.search_product_variant_recall(uuid, integer) IS 'Published-merchant variant attributes for discovery recall; NULL merchant returns no rows.';
