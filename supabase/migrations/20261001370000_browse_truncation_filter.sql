-- Browse snapshot-truncation filter. Hydration serves at most the 128
-- cheapest non-anchor variants per product and the selector drops
-- truncated rows outright, so oversized parents admitted here only consume
-- the capped window ahead of servable matches. Products with more than 128
-- non-anchor variants now filter before paging, mirroring the recall
-- bound exactly. Same eight-argument signature: CREATE OR REPLACE, no drop.
CREATE OR REPLACE FUNCTION public.search_products_browse(
  p_merchant_id uuid,
  p_brand text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_sort text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0,
  p_condition text DEFAULT NULL,
  p_excluded_types jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  discovery_metadata jsonb,
  slug text,
  price numeric,
  compare_at_price numeric,
  images jsonb,
  condition text,
  condition_detail text,
  available_conditions text[],
  has_condition_offers boolean,
  brand text,
  category text,
  manage_stock boolean,
  stock_quantity integer,
  has_variants boolean,
  inventory_tracking_policy text,
  updated_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  -- Anonymous-executable boundary: the MCP schema caps brand and category
  -- at 50 characters, and every legitimate condition spelling (enum values
  -- plus the documented case/space/dash tolerance) sits far below it, so
  -- longer inputs reject before translate/regex/substring CPU.
  IF pg_catalog.char_length(p_brand) > 50 THEN
    RAISE EXCEPTION 'browse accepts brand filters of at most 50 characters'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.char_length(p_category) > 50 THEN
    RAISE EXCEPTION 'browse accepts category filters of at most 50 characters'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.char_length(p_condition) > 50 THEN
    RAISE EXCEPTION 'browse accepts condition filters of at most 50 characters'
      USING ERRCODE = '22023';
  END IF;
  -- Same boundary for excluded types: at most 10 entries, sized as in
  -- recall (10 maxed texts reach ~6KB, well under the byte cap).
  IF pg_catalog.jsonb_typeof(p_excluded_types) = 'array'
    AND (pg_catalog.jsonb_array_length(p_excluded_types) > 10
      OR pg_catalog.octet_length(p_excluded_types::text) > 8192) THEN
    RAISE EXCEPTION 'browse accepts at most 10 excluded product types'
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH requested AS (
    -- The requested condition canonicalizes once, mirroring hydration.
    SELECT discovery.canonical_product_condition(p_condition) AS condition
  ),
  excluded_types AS (
    -- Intent-level excluded product types, canonicalized once (fail open).
    SELECT coalesce(array_agg(DISTINCT discovery.canonical_identity_product_type(elem, NULL))
      FILTER (WHERE discovery.canonical_identity_product_type(elem, NULL) IS NOT NULL),
      '{}'::text[]) AS types
    FROM pg_catalog.jsonb_array_elements_text(
      CASE WHEN pg_catalog.jsonb_typeof(p_excluded_types) = 'array' THEN p_excluded_types ELSE '[]'::jsonb END
    ) AS elem
  ),
  merchant_branches AS (
    SELECT count(*)::integer AS branch_count, (array_agg(b.id))[1] AS only_branch_id
    FROM public.branches AS b
    WHERE b.merchant_id = p_merchant_id AND b.active = true
  ),
  variant_counts AS (
    -- Non-anchor variants per merchant product, mirroring the hydration
    -- projection's counted set exactly.
    SELECT pv.product_id, count(*)::integer AS visible
    FROM public.product_variants AS pv
    WHERE pv.merchant_id = p_merchant_id
      AND pv.is_inventory_anchor IS NOT TRUE
    GROUP BY pv.product_id
  )
  SELECT p.id, p.name, p.description, p.discovery_metadata, p.slug, p.price,
    p.compare_at_price, p.images, p.condition, p.condition_detail,
    p.available_conditions, p.has_condition_offers, p.brand, p.category,
    p.manage_stock, p.stock_quantity, p.has_variants,
    p.inventory_tracking_policy, p.updated_at, p.created_at
  FROM public.products AS p
  JOIN public.merchants AS m ON m.id = p.merchant_id
  CROSS JOIN requested AS requested
  CROSS JOIN excluded_types AS excluded
  CROSS JOIN merchant_branches AS mb
  LEFT JOIN variant_counts AS vc ON vc.product_id = p.id
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN pg_catalog.jsonb_typeof(p.discovery_metadata) = 'object' THEN p.discovery_metadata
      ELSE '{}'::jsonb
    END AS facts
  ) AS meta
  CROSS JOIN LATERAL (
    SELECT discovery.canonical_identity_product_type(meta.facts ->> 'product_type', p.category) AS product_type
  ) AS stored
  WHERE p.merchant_id = p_merchant_id
    AND p.status = 'active'
    AND (
      COALESCE(m.is_published, FALSE) = TRUE
      OR COALESCE(m.is_platform_admin, FALSE) = TRUE
    )
    -- Snapshot-truncated parents never serve, so they filter before the
    -- window instead of consuming it.
    AND COALESCE(vc.visible, 0) <= 128
    -- Intent-level excluded product types filter before paging with the
    -- recall test; under a nonempty exclusion list unknown-type rows drop
    -- too (the matcher marks them unverified and never selects them), so
    -- unverified rows cannot strand verified matches past the window.
    AND (excluded.types = '{}'::text[]
      OR (stored.product_type IS NOT NULL
        AND NOT (stored.product_type = ANY (excluded.types))))
    -- Live-option availability gates every mode: a purchasable variant
    -- under the effective policy and stock rules, or a servable variantless
    -- base (unmanaged or stocked parent, or a live active offer).
    AND (EXISTS (SELECT 1 FROM public.product_variants AS v
        CROSS JOIN LATERAL (SELECT CASE
            WHEN COALESCE(v.inventory_tracking_policy, 'inherit') IN ('off', 'serialized_strict', 'serialized_then_unlimited')
              THEN COALESCE(v.inventory_tracking_policy, 'inherit')
            WHEN COALESCE(p.inventory_tracking_policy, 'off') IN ('serialized_strict', 'serialized_then_unlimited')
              THEN p.inventory_tracking_policy
            ELSE 'off'
          END AS effective_policy) AS policy
        WHERE v.product_id = p.id
          AND v.is_inventory_anchor IS NOT TRUE
          AND (policy.effective_policy = 'serialized_then_unlimited'
            OR (policy.effective_policy = 'off'
              AND (p.manage_stock IS FALSE OR v.stock_quantity > 0))
            OR (policy.effective_policy = 'serialized_strict'
              AND EXISTS (SELECT 1 FROM public.variant_inventory AS vi
                WHERE vi.variant_id = v.id
                  AND vi.merchant_id = p_merchant_id
                  AND vi.status = 'available'
                  AND vi.order_id IS NULL
                  AND vi.order_item_id IS NULL
                  AND vi.sold_at IS NULL
                  AND ((mb.branch_count = 1
                      AND (vi.branch_id = mb.only_branch_id OR vi.branch_id IS NULL))
                    OR (mb.branch_count IS DISTINCT FROM 1 AND vi.branch_id IS NULL))))))
      OR (p.has_variants IS NOT TRUE
        AND (p.manage_stock IS NOT TRUE
          OR COALESCE(p.stock_quantity, 0) > 0
          OR EXISTS (SELECT 1 FROM public.product_offers AS o
            WHERE o.product_id = p.id
              AND o.status = 'active'
              AND (p.manage_stock IS NOT TRUE OR COALESCE(o.stock_quantity, 0) > 0)))))
    -- ASCII-only narrowing mirrors the post-hydration substring match
    -- (literal, case-insensitive over ASCII): rows failing here would be
    -- dropped downstream, so narrowing strands none.
    AND (NULLIF(p_brand, '') IS NULL
      OR pg_catalog.strpos(pg_catalog.translate(p.brand, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), pg_catalog.translate(NULLIF(p_brand, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')) > 0)
    AND (NULLIF(p_category, '') IS NULL
      OR pg_catalog.strpos(pg_catalog.translate(p.category, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), pg_catalog.translate(NULLIF(p_category, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')) > 0)
    -- Requested conditions narrow before paging with the live option
    -- semantics: a matching base on a variantless product, or a selectable
    -- variant/offer option through the shared helper (purchasable variants
    -- under the effective policy, selectable offers). The base never sells
    -- on a variant product, so gating it here matches recall and keeps
    -- stranded rows out of the window.
    AND (requested.condition IS NULL
      OR (p.has_variants IS NOT TRUE
        AND coalesce(discovery.canonical_product_condition(p.condition), 'new') = requested.condition)
      OR discovery.product_condition_option_matches(p.id, p.has_variants,
        coalesce(discovery.canonical_product_condition(p.condition), 'new'), requested.condition,
        p.manage_stock))
  -- A newest sort orders server-side: sorting the capped slice afterward
  -- would hide newer rows past the cap. Null creation dates sort last,
  -- matching the downstream comparator; any other sort keeps stable id
  -- order, where the constant first key orders nothing.
  ORDER BY
    CASE WHEN p_sort = 'newest' THEN p.created_at END DESC NULLS LAST,
    p.id ASC
  LIMIT least(greatest(coalesce(p_limit, 100), 1), 1000)
  OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$$;

ALTER FUNCTION public.search_products_browse(uuid, text, text, text, integer, integer, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.search_products_browse(uuid, text, text, text, integer, integer, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_products_browse(uuid, text, text, text, integer, integer, text, jsonb) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.search_products_browse(uuid, text, text, text, integer, integer, text, jsonb) IS 'Published-merchant browse window with ASCII-only brand/category narrowing, condition narrowing, and excluded-type filtering before the cap.';
