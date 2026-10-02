-- Keep the bounded public hydration contract while sourcing policy, stock,
-- tenant/publication scope, and anchor exclusion from the shared projection.
CREATE OR REPLACE FUNCTION public.get_mcp_search_product_variants(
  p_product_ids uuid[],
  p_merchant_id uuid
)
RETURNS TABLE (
  id uuid,
  product_id uuid,
  attributes jsonb,
  condition text,
  price_override numeric,
  stock_quantity integer,
  effective_policy text,
  created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF COALESCE(pg_catalog.cardinality(p_product_ids), 0) > 100 THEN
    RAISE EXCEPTION 'MCP search option lookup accepts at most 100 products'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH requested_products AS MATERIALIZED (
    SELECT p.id, p.price
    FROM public.products AS p
    JOIN public.merchants AS m ON m.id = p.merchant_id
    WHERE p_product_ids IS NOT NULL
      AND pg_catalog.cardinality(p_product_ids) BETWEEN 1 AND 100
      AND p_merchant_id IS NOT NULL
      AND p.id = ANY(p_product_ids)
      AND p.merchant_id = p_merchant_id
      AND p.status = 'active'
      AND (COALESCE(m.is_published, FALSE) IS TRUE
        OR COALESCE(m.is_platform_admin, FALSE) IS TRUE)
  )
  SELECT option_row.variant_id, product_row.id, option_row.attributes,
    option_row.condition, option_row.price_override, option_row.stock_quantity,
    option_row.effective_policy, option_row.created_at
  FROM requested_products AS product_row
  CROSS JOIN LATERAL (
    SELECT projection.*
    FROM discovery.public_variant_option_projection(
      p_merchant_id, ARRAY[product_row.id]) AS projection
    ORDER BY COALESCE(projection.price_override, product_row.price),
      projection.created_at, projection.variant_id
    LIMIT 129
  ) AS option_row
  ORDER BY product_row.id,
    COALESCE(option_row.price_override, product_row.price), option_row.created_at,
    option_row.variant_id;
END;
$$;

ALTER FUNCTION public.get_mcp_search_product_variants(uuid[], uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_mcp_search_product_variants(uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mcp_search_product_variants(uuid[], uuid)
  TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.get_mcp_search_product_variants(uuid[], uuid) IS
  'Published same-merchant search variants from the canonical projection, at most 129 ordered rows per product (128 plus truncation sentinel).';
