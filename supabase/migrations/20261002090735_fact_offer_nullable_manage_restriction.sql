-- NULL-manage restriction for fact retrieval and the shared offer
-- helper. The PDP normalizes legacy NULL manage_stock to managed
-- inventory, so the IS NOT TRUE offer and parent gates wrongly admit
-- NULL-manage depleted rows. Only explicit FALSE now bypasses the
-- stock check, matching the base helper, the canonical variant
-- helper, and the publication-bounds pins. Unchanged signatures:
-- CREATE OR REPLACE, no drops.
CREATE OR REPLACE FUNCTION public.search_product_discovery_facts(
  merchant_id_param uuid, query_text text,
  result_limit integer DEFAULT 100, result_offset integer DEFAULT 0,
  brand_filter text DEFAULT NULL, category_filter text DEFAULT NULL,
  condition_filter text DEFAULT NULL, excluded_types_filter jsonb DEFAULT '[]'::jsonb
) RETURNS TABLE (product_id uuid, total_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  WITH requested AS (
    SELECT discovery.canonical_product_condition(condition_filter) AS condition
  ),
  excluded_types AS (
    SELECT coalesce(array_agg(DISTINCT discovery.canonical_identity_product_type(elem, NULL))
      FILTER (WHERE discovery.canonical_identity_product_type(elem, NULL) IS NOT NULL),
      '{}'::text[]) AS types
    FROM pg_catalog.jsonb_array_elements_text(
      CASE WHEN pg_catalog.jsonb_typeof(excluded_types_filter) = 'array' THEN excluded_types_filter ELSE '[]'::jsonb END
    ) AS elem
  )
  SELECT p.id, count(*) OVER () FROM public.products p
  CROSS JOIN requested AS requested
  CROSS JOIN excluded_types AS excluded
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN pg_catalog.jsonb_typeof(p.discovery_metadata) = 'object' THEN p.discovery_metadata
      ELSE '{}'::jsonb
    END AS facts
  ) AS meta
  CROSS JOIN LATERAL (
    SELECT discovery.canonical_identity_product_type(meta.facts ->> 'product_type', p.category) AS product_type
  ) AS stored
  -- Anchor-resolved base policy rides one row per product (NULL policy
  -- means off: the anchor RPC returns serialized rows only). Variant
  -- products skip the RPC: their policy resolves per variant below.
  CROSS JOIN LATERAL (
    SELECT
      CASE WHEN p.has_variants IS NOT TRUE
        THEN (SELECT a.effective_policy
          FROM public.get_mcp_search_serialized_anchor_policies(ARRAY[p.id], merchant_id_param) AS a
          LIMIT 1) END AS policy,
      CASE WHEN p.has_variants IS NOT TRUE
        THEN COALESCE((SELECT a.available_units
          FROM public.get_mcp_search_serialized_anchor_policies(ARRAY[p.id], merchant_id_param) AS a
          LIMIT 1), 0)
        ELSE 0 END AS units
  ) AS anchor
  WHERE p.merchant_id = merchant_id_param AND p.status = 'active'
    AND pg_catalog.char_length(query_text) <= 16000
    AND (brand_filter IS NULL OR pg_catalog.char_length(brand_filter) <= 50)
    AND (category_filter IS NULL OR pg_catalog.char_length(category_filter) <= 50)
    AND (condition_filter IS NULL OR pg_catalog.char_length(condition_filter) <= 50)
    AND (excluded_types_filter IS NULL
      OR pg_catalog.jsonb_typeof(excluded_types_filter) <> 'array'
      OR (pg_catalog.jsonb_array_length(excluded_types_filter) <= 10
        AND pg_catalog.octet_length(excluded_types_filter::text) <= 8192))
    AND (excluded.types = '{}'::text[]
      OR (stored.product_type IS NOT NULL
        AND NOT (stored.product_type = ANY (excluded.types))))
    AND (brand_filter IS NULL OR pg_catalog.strpos(
      pg_catalog.translate(p.brand, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), pg_catalog.translate(brand_filter, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')) > 0)
    AND (category_filter IS NULL OR pg_catalog.strpos(
      pg_catalog.translate(p.category, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), pg_catalog.translate(category_filter, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')) > 0)
    -- Live-option availability gates every mode: a purchasable variant
    -- under the effective policy and stock rules (the projection already
    -- resolves serialized stock to public available units), or a
    -- servable variantless base (live offer, anchor-resolved serialized
    -- policy, or unmanaged/stocked parent under off).
    AND (EXISTS (SELECT 1
        FROM public.get_mcp_search_product_variants(ARRAY[p.id], merchant_id_param) AS v
        WHERE v.effective_policy = 'serialized_then_unlimited'
          OR (v.effective_policy = 'off'
            AND (p.manage_stock IS FALSE OR v.stock_quantity > 0))
          OR (v.effective_policy = 'serialized_strict' AND v.stock_quantity > 0))
      OR (p.has_variants IS NOT TRUE
        AND (EXISTS (SELECT 1
            FROM public.get_mcp_search_product_offers(ARRAY[p.id], merchant_id_param) AS o
            WHERE p.manage_stock IS FALSE OR COALESCE(o.stock_quantity, 0) > 0)
          OR anchor.policy = 'serialized_then_unlimited'
          OR (anchor.policy = 'serialized_strict' AND anchor.units > 0)
          OR (anchor.policy IS NULL
            AND (p.manage_stock IS FALSE OR COALESCE(p.stock_quantity, 0) > 0)))))
    -- Snapshot-truncated parents never serve, so they filter before
    -- ranking instead of consuming it.
    AND (SELECT count(*)
      FROM public.get_mcp_search_product_variants(ARRAY[p.id], merchant_id_param)) < 129
    AND (requested.condition IS NULL
      OR (p.has_variants IS NOT TRUE
        AND coalesce(discovery.canonical_product_condition(p.condition), 'new') = requested.condition
        AND discovery.base_product_option_is_purchasable(p.id, merchant_id_param))
      OR discovery.product_condition_option_matches(p.id, p.has_variants,
        coalesce(discovery.canonical_product_condition(p.condition), 'new'), requested.condition,
        p.manage_stock))
    AND discovery.product_discovery_search_document_v5(p.name, p.brand, p.category,
      p.description, p.discovery_metadata)
      @@ pg_catalog.to_tsquery('simple'::regconfig, query_text)
  ORDER BY pg_catalog.ts_rank(discovery.product_discovery_search_document_v5(p.name, p.brand,
      p.category, p.description, p.discovery_metadata),
    pg_catalog.to_tsquery('simple'::regconfig, query_text)) DESC, p.id
  LIMIT least(greatest(coalesce(result_limit, 100), 1), 100)
  OFFSET least(greatest(coalesce(result_offset, 0), 0), 500);
$$;

-- Same restriction for the shared offer helper's unmanaged branch.
CREATE OR REPLACE FUNCTION discovery.condition_offer_selectable(
  p_product_id uuid,
  p_has_variants boolean,
  p_condition text,
  p_manage_stock boolean
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH stored AS (
    SELECT p.has_variants, p.manage_stock
    FROM public.products AS p
    JOIN public.merchants AS m ON m.id = p.merchant_id
    WHERE p.id = p_product_id
      AND p.status = 'active'
      AND (COALESCE(m.is_published, FALSE) IS TRUE
        OR COALESCE(m.is_platform_admin, FALSE) IS TRUE)
  ),
  windowed AS (
    SELECT o.id, o.condition, o.stock_quantity
    FROM stored AS s
    JOIN public.product_offers AS o
      ON o.product_id = p_product_id AND o.status = 'active'
    ORDER BY o.condition, o.id LIMIT 16
  ),
  first_match AS (
    SELECT w.stock_quantity
    FROM windowed AS w
    WHERE discovery.canonical_product_condition(w.condition) = p_condition
    ORDER BY w.condition, w.id LIMIT 1
  )
  SELECT (EXISTS (SELECT 1 FROM windowed AS w
      WHERE discovery.canonical_product_condition(w.condition) = p_condition)
    AND EXISTS (SELECT 1 FROM stored AS s
      WHERE COALESCE(s.has_variants, FALSE) OR s.manage_stock IS FALSE)
    OR EXISTS (SELECT 1 FROM first_match AS f
      WHERE COALESCE(f.stock_quantity, 0) > 0))
  AND NOT (EXISTS (SELECT 1 FROM stored AS s WHERE s.has_variants IS TRUE)
    AND EXISTS (SELECT 1 FROM public.product_variants AS v
      WHERE v.product_id = p_product_id
        AND v.is_inventory_anchor IS NOT TRUE
        AND discovery.canonical_product_condition(v.condition) IS NOT NULL));
$$;

ALTER FUNCTION discovery.condition_offer_selectable(uuid, boolean, text, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION discovery.condition_offer_selectable(uuid, boolean, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION discovery.condition_offer_selectable(uuid, boolean, text, boolean)
  TO anon, authenticated, service_role;
COMMENT ON FUNCTION discovery.condition_offer_selectable(uuid, boolean, text, boolean) IS
  'Checks only published active products and their first 16 ordered active offers; stored product fields override caller hints.';
