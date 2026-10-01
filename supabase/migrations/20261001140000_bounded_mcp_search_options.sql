-- Search needs the same public option ordering/windows as the storefront, but
-- the legacy batch variant RPC and direct offer query return every option.
-- Keep each result bounded per product before it crosses PostgREST.
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
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(pg_catalog.cardinality(p_product_ids), 0) > 100 THEN
    RAISE EXCEPTION 'MCP search option lookup accepts at most 100 products'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH requested_products AS MATERIALIZED (
    SELECT p.id, p.merchant_id, p.price, p.inventory_tracking_policy
    FROM public.products AS p
    JOIN public.merchants AS m ON m.id = p.merchant_id
    WHERE p_product_ids IS NOT NULL
      AND p_merchant_id IS NOT NULL
      AND pg_catalog.cardinality(p_product_ids) BETWEEN 1 AND 100
      AND p.id = ANY (p_product_ids)
      AND p.merchant_id = p_merchant_id
      AND p.status = 'active'
      AND COALESCE(m.is_published, FALSE) IS TRUE
  ),
  merchant_branches AS (
    SELECT count(*)::integer AS branch_count, (array_agg(b.id))[1] AS only_branch_id
    FROM public.branches AS b
    WHERE b.merchant_id = p_merchant_id AND b.active = true
  ),
  available_units AS (
    SELECT vi.variant_id, count(*)::integer AS available
    FROM public.variant_inventory AS vi
    CROSS JOIN merchant_branches AS mb
    WHERE vi.merchant_id = p_merchant_id
      AND vi.status = 'available'
      AND vi.order_id IS NULL
      AND vi.order_item_id IS NULL
      AND vi.sold_at IS NULL
      AND (
        (mb.branch_count = 1 AND (vi.branch_id = mb.only_branch_id OR vi.branch_id IS NULL))
        OR (mb.branch_count IS DISTINCT FROM 1 AND vi.branch_id IS NULL)
      )
    GROUP BY vi.variant_id
  )
  SELECT
    option_row.id,
    product_row.id,
    option_row.attributes,
    option_row.condition,
    option_row.price_override,
    option_row.stock_quantity,
    option_row.created_at
  FROM requested_products AS product_row
  CROSS JOIN LATERAL (
    -- Effective stock mirrors the storefront projection
    -- (hydrate-public-products.ts): serialized policies replace stored
    -- stock with public available units, and serialized_then_unlimited
    -- reports 9999 once units run out instead of reading as sold out.
    SELECT v.id, v.attributes, v.condition, v.price_override,
      CASE
        WHEN policy.effective_policy = 'serialized_then_unlimited'
          AND COALESCE(units.available, 0) = 0 THEN 9999
        WHEN policy.effective_policy IN ('serialized_strict', 'serialized_then_unlimited')
          THEN COALESCE(units.available, 0)
        ELSE v.stock_quantity
      END AS stock_quantity,
      v.created_at
    FROM public.product_variants AS v
    LEFT JOIN available_units AS units ON units.variant_id = v.id
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN COALESCE(v.inventory_tracking_policy, 'inherit') IN ('off', 'serialized_strict', 'serialized_then_unlimited')
          THEN COALESCE(v.inventory_tracking_policy, 'inherit')
        WHEN COALESCE(product_row.inventory_tracking_policy, 'off') IN ('serialized_strict', 'serialized_then_unlimited')
          THEN product_row.inventory_tracking_policy
        ELSE 'off'
      END AS effective_policy
    ) AS policy
    WHERE v.product_id = product_row.id
      AND v.merchant_id = product_row.merchant_id
      AND v.is_inventory_anchor IS NOT TRUE
    ORDER BY COALESCE(v.price_override, product_row.price), v.created_at, v.id
    LIMIT 129
  ) AS option_row
  ORDER BY product_row.id,
    COALESCE(option_row.price_override, product_row.price),
    option_row.created_at,
    option_row.id;
END;
$$;

ALTER FUNCTION public.get_mcp_search_product_variants(uuid[], uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_mcp_search_product_variants(uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mcp_search_product_variants(uuid[], uuid)
  TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.get_mcp_search_product_variants(uuid[], uuid) IS
  'Published same-merchant search variant projection, at most 129 ordered rows per product (128 plus a truncation sentinel).';

CREATE OR REPLACE FUNCTION public.get_mcp_search_product_offers(
  p_product_ids uuid[],
  p_merchant_id uuid
)
RETURNS TABLE (
  id uuid,
  product_id uuid,
  condition text,
  price numeric,
  compare_at_price numeric,
  stock_quantity integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(pg_catalog.cardinality(p_product_ids), 0) > 100 THEN
    RAISE EXCEPTION 'MCP search option lookup accepts at most 100 products'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH requested_products AS MATERIALIZED (
    SELECT p.id, p.merchant_id
    FROM public.products AS p
    JOIN public.merchants AS m ON m.id = p.merchant_id
    WHERE p_product_ids IS NOT NULL
      AND p_merchant_id IS NOT NULL
      AND pg_catalog.cardinality(p_product_ids) BETWEEN 1 AND 100
      AND p.id = ANY (p_product_ids)
      AND p.merchant_id = p_merchant_id
      AND p.status = 'active'
      AND COALESCE(m.is_published, FALSE) IS TRUE
  )
  SELECT
    option_row.id,
    product_row.id,
    option_row.condition,
    option_row.price,
    option_row.compare_at_price,
    option_row.stock_quantity
  FROM requested_products AS product_row
  CROSS JOIN LATERAL (
    SELECT o.id, o.condition, o.price, o.compare_at_price, o.stock_quantity
    FROM public.product_offers AS o
    WHERE o.product_id = product_row.id
      AND o.merchant_id = product_row.merchant_id
      AND o.status = 'active'
    ORDER BY o.condition, o.id
    LIMIT 16
  ) AS option_row
  ORDER BY product_row.id, option_row.condition, option_row.id;
END;
$$;

ALTER FUNCTION public.get_mcp_search_product_offers(uuid[], uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_mcp_search_product_offers(uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mcp_search_product_offers(uuid[], uuid)
  TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.get_mcp_search_product_offers(uuid[], uuid) IS
  'Published same-merchant search offer projection, at most the PDP’s ordered 16 active offers per product.';
