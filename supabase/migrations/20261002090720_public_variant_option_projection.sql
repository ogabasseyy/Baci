-- Shared public variant policy and inventory projection for search and
-- hydration. All consumers see the same published tenant boundary, anchor
-- exclusion, inherited policy, and public-branch serialized-unit count.
CREATE OR REPLACE FUNCTION discovery.public_variant_option_projection(
  p_merchant_id uuid,
  p_product_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  product_id uuid,
  variant_id uuid,
  attributes jsonb,
  condition text,
  price_override numeric,
  created_at timestamptz,
  effective_policy text,
  available_units integer,
  stock_quantity integer,
  is_purchasable boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH merchant_branches AS (
    SELECT count(*)::integer AS branch_count, (array_agg(b.id))[1] AS only_branch_id
    FROM public.branches AS b
    WHERE b.merchant_id = p_merchant_id AND b.active IS TRUE
  ),
  public_products AS MATERIALIZED (
    SELECT p.id, p.merchant_id, p.manage_stock, p.stock_quantity,
      p.inventory_tracking_policy
    FROM public.products AS p
    JOIN public.merchants AS m ON m.id = p.merchant_id
    WHERE p_merchant_id IS NOT NULL
      AND p.merchant_id = p_merchant_id
      AND p.status = 'active'
      AND (p_product_ids IS NULL OR p.id = ANY(p_product_ids))
      AND (COALESCE(m.is_published, FALSE) IS TRUE
        OR COALESCE(m.is_platform_admin, FALSE) IS TRUE)
  ),
  public_variants AS MATERIALIZED (
    SELECT v.id, v.product_id, v.merchant_id, v.attributes, v.condition,
      v.price_override, v.created_at, v.inventory_tracking_policy,
      v.stock_quantity
    FROM public.product_variants AS v
    JOIN public_products AS p
      ON p.id = v.product_id AND p.merchant_id = v.merchant_id
    WHERE v.is_inventory_anchor IS NOT TRUE
  ),
  available_units AS (
    SELECT vi.variant_id, count(*)::integer AS available
    FROM public.variant_inventory AS vi
    JOIN public_variants AS v ON v.id = vi.variant_id
    CROSS JOIN merchant_branches AS mb
    WHERE vi.merchant_id = p_merchant_id
      AND vi.status = 'available'
      AND vi.order_id IS NULL
      AND vi.order_item_id IS NULL
      AND vi.sold_at IS NULL
      AND ((mb.branch_count = 1
          AND (vi.branch_id = mb.only_branch_id OR vi.branch_id IS NULL))
        OR (mb.branch_count IS DISTINCT FROM 1 AND vi.branch_id IS NULL))
    GROUP BY vi.variant_id
  ),
  resolved AS (
    SELECT p.id AS product_id, v.id AS variant_id, v.attributes, v.condition,
      v.price_override, v.created_at, p.manage_stock, p.stock_quantity AS parent_stock,
      v.stock_quantity AS stored_stock,
      COALESCE(units.available, 0) AS available_units,
      CASE
        WHEN COALESCE(v.inventory_tracking_policy, 'inherit')
          IN ('off', 'serialized_strict', 'serialized_then_unlimited')
          THEN COALESCE(v.inventory_tracking_policy, 'inherit')
        WHEN COALESCE(p.inventory_tracking_policy, 'off')
          IN ('serialized_strict', 'serialized_then_unlimited')
          THEN p.inventory_tracking_policy
        ELSE 'off'
      END AS effective_policy
    FROM public_products AS p
    JOIN public_variants AS v ON v.product_id = p.id AND v.merchant_id = p.merchant_id
    LEFT JOIN available_units AS units ON units.variant_id = v.id
  )
  SELECT r.product_id, r.variant_id, r.attributes, r.condition,
    r.price_override, r.created_at, r.effective_policy, r.available_units,
    CASE
      WHEN r.effective_policy = 'serialized_then_unlimited'
        AND r.available_units = 0 THEN 9999
      WHEN r.effective_policy IN ('serialized_strict', 'serialized_then_unlimited')
        THEN r.available_units
      ELSE COALESCE(r.stored_stock, r.parent_stock)
    END AS stock_quantity,
    ((r.effective_policy = 'off'
        AND (r.manage_stock IS FALSE
          OR COALESCE(COALESCE(r.stored_stock, r.parent_stock) > 0, FALSE)))
      OR r.effective_policy = 'serialized_then_unlimited'
      OR (r.effective_policy = 'serialized_strict' AND r.available_units > 0))
      AS is_purchasable
  FROM resolved AS r;
$$;

ALTER FUNCTION discovery.public_variant_option_projection(uuid, uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION discovery.public_variant_option_projection(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION discovery.public_variant_option_projection(uuid, uuid[]) FROM anon, authenticated, service_role;
COMMENT ON FUNCTION discovery.public_variant_option_projection(uuid, uuid[]) IS
  'Private canonical published-merchant non-anchor variant projection with inherited stock policy and public serialized inventory.';
