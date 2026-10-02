-- Search needs the same public option ordering/windows as the storefront, but
-- the legacy batch variant RPC and direct offer query return every option.
-- Keep each result bounded per product before it crosses PostgREST.
-- New column changes the return type: drop first (no dependents: dynamic RPC calls only).
DROP FUNCTION IF EXISTS public.get_mcp_search_product_variants(uuid[], uuid);
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
      -- Platform-admin storefronts stay publicly visible (same exemption
      -- as the PDP and variant recall); ordinary unpublished merchants
      -- still return no rows.
      AND (
        COALESCE(m.is_published, FALSE) IS TRUE
        OR COALESCE(m.is_platform_admin, FALSE) IS TRUE
      )
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
    option_row.effective_policy,
    option_row.created_at
  FROM requested_products AS product_row
  CROSS JOIN LATERAL (
    -- Effective stock mirrors the storefront projection
    -- (hydrate-public-products.ts): serialized policies replace stored
    -- stock with public available units, and serialized_then_unlimited
    -- reports 9999 once units run out instead of reading as sold out.
    -- The effective policy rides along so hydration gates each variant by
    -- its own policy instead of the parent's manage_stock alone: an
    -- explicit serialized_strict variant under an unmanaged parent is
    -- stock-gated, matching isPublicVariantPurchasable.
    SELECT v.id, v.attributes, v.condition, v.price_override,
      CASE
        WHEN policy.effective_policy = 'serialized_then_unlimited'
          AND COALESCE(units.available, 0) = 0 THEN 9999
        WHEN policy.effective_policy IN ('serialized_strict', 'serialized_then_unlimited')
          THEN COALESCE(units.available, 0)
        ELSE v.stock_quantity
      END AS stock_quantity,
      policy.effective_policy,
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
      -- Platform-admin storefronts stay publicly visible (same exemption
      -- as the PDP and variant recall); ordinary unpublished merchants
      -- still return no rows.
      AND (
        COALESCE(m.is_published, FALSE) IS TRUE
        OR COALESCE(m.is_platform_admin, FALSE) IS TRUE
      )
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

-- Simple serialized policies resolve in-database: product_variants SELECT is
-- authenticated-only, so anon direct-table reads miss anchors and evaluate
-- the wrong policy. Serialized rows only; off resolves to stored stock by absence.
DROP FUNCTION IF EXISTS public.get_mcp_search_serialized_anchor_policies(uuid[], uuid);
CREATE OR REPLACE FUNCTION public.get_mcp_search_serialized_anchor_policies(
  p_product_ids uuid[],
  p_merchant_id uuid
)
RETURNS TABLE (
  product_id uuid,
  effective_policy text,
  available_units integer
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
    SELECT p.id, p.merchant_id, p.inventory_tracking_policy
    FROM public.products AS p
    JOIN public.merchants AS m ON m.id = p.merchant_id
    WHERE p_product_ids IS NOT NULL
      AND p_merchant_id IS NOT NULL
      AND pg_catalog.cardinality(p_product_ids) BETWEEN 1 AND 100
      AND p.id = ANY (p_product_ids)
      AND p.merchant_id = p_merchant_id
      AND p.status = 'active'
      AND p.has_variants IS NOT TRUE
      AND (
        COALESCE(m.is_published, FALSE) IS TRUE
        OR COALESCE(m.is_platform_admin, FALSE) IS TRUE
      )
  ),
  merchant_branches AS (
    SELECT count(*)::integer AS branch_count, (array_agg(b.id))[1] AS only_branch_id
    FROM public.branches AS b
    WHERE b.merchant_id = p_merchant_id AND b.active = true
  ),
  anchor_units AS (
    SELECT pv.product_id, count(vi.id)::integer AS available
    FROM public.product_variants AS pv
    JOIN requested_products AS rp ON rp.id = pv.product_id
    JOIN public.variant_inventory AS vi ON vi.variant_id = pv.id
    CROSS JOIN merchant_branches AS mb
    WHERE pv.merchant_id = p_merchant_id
      AND pv.is_inventory_anchor IS TRUE
      AND vi.status = 'available'
      AND vi.order_id IS NULL
      AND vi.order_item_id IS NULL
      AND vi.sold_at IS NULL
      AND (
        (mb.branch_count = 1 AND (vi.branch_id = mb.only_branch_id OR vi.branch_id IS NULL))
        OR (mb.branch_count IS DISTINCT FROM 1 AND vi.branch_id IS NULL)
      )
    GROUP BY pv.product_id
  ),
  anchors AS (
    SELECT DISTINCT ON (pv.product_id) pv.product_id, pv.inventory_tracking_policy
    FROM public.product_variants AS pv
    JOIN requested_products AS rp ON rp.id = pv.product_id
    WHERE pv.merchant_id = p_merchant_id
      AND pv.is_inventory_anchor IS TRUE
    ORDER BY pv.product_id, pv.id
  )
  SELECT resolved.product_id, resolved.effective_policy, resolved.available_units FROM (
    SELECT
      product_row.id AS product_id,
      CASE
        WHEN COALESCE(anchor.inventory_tracking_policy, 'inherit') IN ('off', 'serialized_strict', 'serialized_then_unlimited')
          THEN COALESCE(anchor.inventory_tracking_policy, 'inherit')
        WHEN COALESCE(product_row.inventory_tracking_policy, 'off') IN ('serialized_strict', 'serialized_then_unlimited')
          THEN product_row.inventory_tracking_policy
        ELSE 'off'
      END AS effective_policy,
      COALESCE(units.available, 0) AS available_units
    FROM requested_products AS product_row
    LEFT JOIN anchor_units AS units ON units.product_id = product_row.id
    LEFT JOIN anchors AS anchor ON anchor.product_id = product_row.id
  ) AS resolved
  WHERE resolved.effective_policy IN ('serialized_strict', 'serialized_then_unlimited')
  ORDER BY resolved.product_id;
END;
$$;

ALTER FUNCTION public.get_mcp_search_serialized_anchor_policies(uuid[], uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_mcp_search_serialized_anchor_policies(uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mcp_search_serialized_anchor_policies(uuid[], uuid)
  TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.get_mcp_search_serialized_anchor_policies(uuid[], uuid) IS
  'Resolved serialized policy plus public anchor units for simple search products.';
