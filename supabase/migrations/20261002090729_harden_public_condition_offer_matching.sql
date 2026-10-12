-- Condition matching is an anon-executable SECURITY DEFINER helper. Resolve
-- publication, stock management, variant ownership, and base condition from
-- stored rows; caller-supplied booleans/text must never widen the result.
CREATE OR REPLACE FUNCTION discovery.condition_offer_selectable(
  p_product_id uuid,
  p_has_variants boolean,
  p_condition text,
  p_manage_stock boolean
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.products AS p
    JOIN public.merchants AS m ON m.id = p.merchant_id
    CROSS JOIN LATERAL public.get_mcp_search_product_offers(
      ARRAY[p.id], p.merchant_id) AS o
    WHERE p.id = p_product_id
      AND p.status = 'active'
      AND (COALESCE(m.is_published, FALSE) IS TRUE
        OR COALESCE(m.is_platform_admin, FALSE) IS TRUE)
      AND discovery.canonical_product_condition(o.condition) = p_condition
      AND (p.has_variants IS TRUE
        OR p.manage_stock IS NOT TRUE
        OR COALESCE(o.stock_quantity, 0) > 0)
      AND NOT (p.has_variants IS TRUE
        AND EXISTS (
          SELECT 1 FROM public.product_variants AS v
          WHERE v.product_id = p.id
            AND v.merchant_id = p.merchant_id
            AND v.is_inventory_anchor IS NOT TRUE
            AND discovery.canonical_product_condition(v.condition) IS NOT NULL
        ))
  );
$$;

ALTER FUNCTION discovery.condition_offer_selectable(uuid, boolean, text, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION discovery.condition_offer_selectable(uuid, boolean, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION discovery.condition_offer_selectable(uuid, boolean, text, boolean)
  TO anon, authenticated, service_role;
COMMENT ON FUNCTION discovery.condition_offer_selectable(uuid, boolean, text, boolean) IS
  'Checks only published active products and their first 16 ordered active offers; stored product fields override caller hints.';

CREATE OR REPLACE FUNCTION discovery.product_condition_option_matches(
  p_product_id uuid,
  p_has_variants boolean,
  p_base_condition text,
  p_condition text,
  p_manage_stock boolean
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH visible_product AS MATERIALIZED (
    SELECT p.id, p.merchant_id, p.has_variants, p.condition
    FROM public.products AS p
    JOIN public.merchants AS m ON m.id = p.merchant_id
    WHERE p.id = p_product_id
      AND p.status = 'active'
      AND (COALESCE(m.is_published, FALSE) IS TRUE
        OR COALESCE(m.is_platform_admin, FALSE) IS TRUE)
  ),
  purchasable_variants AS (
    SELECT option_row.condition
    FROM visible_product AS p
    CROSS JOIN LATERAL discovery.public_variant_option_projection(
      p.merchant_id, ARRAY[p.id]) AS option_row
    WHERE p.has_variants IS TRUE
      AND option_row.is_purchasable IS TRUE
  )
  SELECT EXISTS (
      SELECT 1 FROM purchasable_variants AS pv
      CROSS JOIN visible_product AS p
      WHERE COALESCE(discovery.canonical_product_condition(pv.condition),
        COALESCE(discovery.canonical_product_condition(p.condition), 'new')) = p_condition
    )
    OR ((EXISTS (SELECT 1 FROM visible_product AS p
            WHERE p.has_variants IS NOT TRUE)
        OR EXISTS (SELECT 1 FROM purchasable_variants))
      AND discovery.condition_offer_selectable(p_product_id, NULL, p_condition, NULL));
$$;

ALTER FUNCTION discovery.product_condition_option_matches(uuid, boolean, text, text, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION discovery.product_condition_option_matches(uuid, boolean, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION discovery.product_condition_option_matches(uuid, boolean, text, text, boolean)
  TO anon, authenticated, service_role;
COMMENT ON FUNCTION discovery.product_condition_option_matches(uuid, boolean, text, text, boolean) IS
  'Condition predicate over published products, purchasable public variants, and the bounded public offer projection.';
