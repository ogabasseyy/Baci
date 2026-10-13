-- Route variant recall purchasability through the canonical public option
-- projection. Ranking and fact matching remain identical to the prior RPC.
-- Variant recall snapshot-truncation filter. Hydration serves at most
-- the 128 cheapest non-anchor variants per product and the selector drops
-- truncated rows outright, so oversized parents admitted here only consume
-- the capped window ahead of servable matches. Products with more than 128
-- non-anchor variants now filter before ranking; the count mirrors the
-- projection exactly (same merchant scope, same anchor exclusion), so no
-- servable row is lost. Same nine-argument signature: CREATE OR REPLACE,
-- no drop.
CREATE OR REPLACE FUNCTION public.search_product_variant_recall(
  p_merchant_id uuid,
  p_filters jsonb DEFAULT '[]'::jsonb,
  p_limit integer DEFAULT 2000,
  p_offset integer DEFAULT 0,
  p_identity jsonb DEFAULT '[]'::jsonb,
  p_excluded_types jsonb DEFAULT '[]'::jsonb,
  p_brand text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_condition text DEFAULT NULL
) RETURNS TABLE (product_id uuid, attributes jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  -- Anonymous-executable boundary: the shared assertion helper bounds
  -- every argument before the query (defined just before this migration).
  PERFORM discovery.assert_variant_recall_input_bounds(
    p_filters, p_identity, p_excluded_types, p_brand, p_category, p_condition);
  RETURN QUERY
  WITH filters AS (
    -- Normalize once: non-array input means no filtering, and the CASE
    -- keeps expansion away from erroring values. Branches score separately
    -- (alternatives are OR branches); malformed branches fall to group zero.
    SELECT filter_element.value AS filter,
      CASE WHEN filter_element.value ->> 'branch' ~ '^-?[0-9]{1,9}$'
        THEN (filter_element.value ->> 'branch')::integer
        ELSE 0
      END AS branch
    FROM pg_catalog.jsonb_array_elements(
      CASE WHEN pg_catalog.jsonb_typeof(p_filters) = 'array' THEN p_filters ELSE '[]'::jsonb END
    ) AS filter_element
  ),
  identity AS (
    -- Per-branch specified identity, normalized once; malformed branches
    -- fall to group zero (fail open), expected types canonicalized.
    SELECT
      CASE WHEN identity_element.value ->> 'branch' ~ '^-?[0-9]{1,9}$'
        THEN (identity_element.value ->> 'branch')::integer
        ELSE 0
      END AS branch,
      discovery.canonical_identity_product_type(identity_element.value ->> 'product_type', NULL) AS product_type,
      (SELECT coalesce(pg_catalog.array_agg(DISTINCT brand.norm), '{}'::text[])
       FROM (SELECT nullif(discovery.discovery_identity_matcher_normalize(brand_elem), '') AS norm
             FROM pg_catalog.jsonb_array_elements_text(
               CASE WHEN pg_catalog.jsonb_typeof(identity_element.value -> 'brands') = 'array'
               THEN identity_element.value -> 'brands' ELSE '[]'::jsonb END) AS brand_elem) AS brand
       WHERE brand.norm IS NOT NULL) AS brands,
      nullif(discovery.discovery_identity_matcher_normalize(identity_element.value ->> 'model'), '') AS model,
      nullif(discovery.discovery_identity_matcher_normalize(identity_element.value ->> 'compatible_with'), '') AS compatible_with
    FROM pg_catalog.jsonb_array_elements(
      CASE WHEN pg_catalog.jsonb_typeof(p_identity) = 'array' THEN p_identity ELSE '[]'::jsonb END
    ) AS identity_element
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
  requested AS (
    -- The requested condition canonicalizes once, mirroring hydration: a
    -- legacy spelling (refurbished) matches canonical stored rows, and an
    -- unrecognized request narrows nothing (NULL behaves as absent).
    SELECT discovery.canonical_product_condition(p_condition) AS condition
  ),
  public_variants AS MATERIALIZED (
    SELECT projection.variant_id, projection.available_units, projection.is_purchasable
    FROM discovery.public_variant_option_projection(p_merchant_id, NULL) AS projection
  ),
  variant_counts AS (
    -- Non-anchor variants per merchant product, mirroring the hydration
    -- projection's counted set exactly.
    SELECT pv.product_id, count(*)::integer AS visible
    FROM public.product_variants AS pv
    WHERE pv.merchant_id = p_merchant_id
      AND pv.is_inventory_anchor IS NOT TRUE
    GROUP BY pv.product_id
  ),
  eligible AS (
    SELECT pv.product_id, pv.attributes, pv.created_at, pv.id,
      -- Branch-grouped exactness: a hybrid matching one constraint per
      -- branch must not tie a variant completing one branch. Complete
      -- branches rank first, then the best per-branch exact count.
      (SELECT count(*) FROM (
        SELECT f.branch
        FROM filters AS f
        GROUP BY f.branch
        HAVING count(*) FILTER (
          WHERE discovery.recall_variant_filter_exactly_matches(pv.attributes, f.filter)
        ) = count(*)
      ) AS completed) AS complete_branch_count,
      COALESCE((SELECT max(exact_matches) FROM (
        SELECT count(*) FILTER (
          WHERE discovery.recall_variant_filter_exactly_matches(pv.attributes, f.filter)
        ) AS exact_matches
        FROM filters AS f
        GROUP BY f.branch
      ) AS per_branch), 0) AS best_branch_exact,
      EXISTS (SELECT 1 FROM filters
        WHERE discovery.recall_variant_filter_loader_accepts(pv.attributes, filters.filter)) AS is_accepted,
      -- Joint tiers (see the joint lateral) plus the verified exclusion
      -- flag, which sinks excluded rows below every non-excluded row.
      joint.complete_alternatives AS complete_alternative_count,
      joint.clear_branches AS clear_branch_count,
      coalesce(stored.product_type = ANY (excluded.types), false) AS identity_excluded,
      COALESCE(public_variant.is_purchasable, FALSE) AS is_purchasable
    FROM public.product_variants AS pv
    JOIN public.products AS p ON p.id = pv.product_id
    JOIN public.merchants AS m ON m.id = p.merchant_id
    JOIN public_variants AS public_variant ON public_variant.variant_id = pv.id
    LEFT JOIN variant_counts AS vc ON vc.product_id = p.id
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN pg_catalog.jsonb_typeof(p.discovery_metadata) = 'object' THEN p.discovery_metadata
        ELSE '{}'::jsonb
      END AS facts
    ) AS meta
    CROSS JOIN LATERAL (
      SELECT
        discovery.canonical_identity_product_type(meta.facts ->> 'product_type', p.category) AS product_type,
        nullif(discovery.discovery_identity_matcher_normalize(p.brand), '') AS brand,
        nullif(discovery.discovery_identity_matcher_normalize(meta.facts ->> 'model'), '') AS model,
        (SELECT coalesce(pg_catalog.array_agg(DISTINCT compat.norm), '{}'::text[])
         FROM (SELECT nullif(discovery.discovery_identity_matcher_normalize(compat_elem), '') AS norm
               FROM pg_catalog.jsonb_array_elements_text(
                 CASE WHEN pg_catalog.jsonb_typeof(meta.facts -> 'compatible_with') = 'array'
                 THEN meta.facts -> 'compatible_with' ELSE '[]'::jsonb END) AS compat_elem) AS compat
         WHERE compat.norm IS NOT NULL) AS compatible_with
    ) AS stored
    CROSS JOIN excluded_types AS excluded
    CROSS JOIN requested AS requested
    CROSS JOIN LATERAL (
      -- Per-branch JOINT verdicts: identity and attributes must satisfy the
      -- SAME branch, or hybrids tie valid products. Absent rows complete
      -- vacuously; IS NOT TRUE keeps NULL verdicts failing. The clear tier
      -- tolerates missing variant attributes while contradictions sink.
      SELECT
        count(*) FILTER (WHERE branch_state.identity_complete AND branch_state.attrs_complete) AS complete_alternatives,
        count(*) FILTER (WHERE branch_state.identity_clear AND branch_state.attrs_clear) AS clear_branches
      FROM (
        SELECT
          b.branch,
          NOT EXISTS (
            SELECT 1 FROM identity AS idn
            WHERE idn.branch = b.branch
              AND ((idn.product_type IS NULL OR stored.product_type = idn.product_type) AND (idn.brands = '{}' OR stored.brand = ANY (idn.brands))
                AND (idn.model IS NULL OR stored.model = idn.model) AND (idn.compatible_with IS NULL OR stored.compatible_with @> ARRAY[idn.compatible_with])) IS NOT TRUE
          ) AS identity_complete,
          NOT EXISTS (
            SELECT 1 FROM identity AS idn
            WHERE idn.branch = b.branch
              AND ((idn.product_type IS NULL OR stored.product_type IS NULL OR stored.product_type = idn.product_type)
                AND (idn.brands = '{}' OR stored.brand IS NULL OR stored.brand = ANY (idn.brands)) AND (idn.model IS NULL OR stored.model IS NULL OR stored.model = idn.model)
                AND (idn.compatible_with IS NULL OR stored.compatible_with = '{}' OR stored.compatible_with @> ARRAY[idn.compatible_with])) IS NOT TRUE
          ) AS identity_clear,
          NOT EXISTS (
            SELECT 1 FROM filters AS f
            WHERE f.branch = b.branch
              AND discovery.recall_variant_filter_exactly_matches(pv.attributes, f.filter) IS NOT TRUE
          ) AS attrs_complete,
          NOT EXISTS (
            SELECT 1 FROM filters AS f
            WHERE f.branch = b.branch
              AND discovery.recall_variant_filter_verifiably_fails(pv.attributes, f.filter)
          ) AS attrs_clear
        FROM (
          SELECT f.branch FROM filters AS f GROUP BY f.branch
          UNION
          SELECT idn.branch FROM identity AS idn GROUP BY idn.branch
        ) AS b
      ) AS branch_state
    ) AS joint
    WHERE pv.merchant_id = p_merchant_id
      AND p.merchant_id = p_merchant_id
      AND p.status = 'active'
      AND pv.is_inventory_anchor IS NOT TRUE
      -- Snapshot-truncated parents never serve, so they filter before the
      -- window instead of consuming it.
      AND COALESCE(vc.visible, 0) <= 128
      AND (
        COALESCE(m.is_published, FALSE) = TRUE
        OR COALESCE(m.is_platform_admin, FALSE) = TRUE
      )
      -- Recall OR: a variant survives when some constraint cannot rule it out.
      AND (
        NOT EXISTS (SELECT 1 FROM filters)
        OR EXISTS (
          SELECT 1 FROM filters
          WHERE NOT discovery.recall_variant_filter_verifiably_fails(pv.attributes, filters.filter)
        )
      )
      -- Catalog filters narrow before the cap, mirroring the hard
      -- post-hydration substring match; narrowing strands none.
      AND (NULLIF(p_brand, '') IS NULL
        OR pg_catalog.strpos(pg_catalog.translate(p.brand, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), pg_catalog.translate(NULLIF(p_brand, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')) > 0)
      AND (NULLIF(p_category, '') IS NULL
        OR pg_catalog.strpos(pg_catalog.translate(p.category, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), pg_catalog.translate(NULLIF(p_category, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')) > 0)
      -- Requested conditions narrow before the cap, mirroring the
      -- post-hydration option match: a variant qualifies on its own
      -- canonical condition with the parent base fallback, a selectable
      -- offer qualifies its product, and a variant-less parent qualifies
      -- on the base.
      AND (requested.condition IS NULL
        OR coalesce(discovery.canonical_product_condition(pv.condition),
          discovery.canonical_product_condition(p.condition), 'new') = requested.condition
        OR discovery.condition_offer_selectable(p.id, p.has_variants, requested.condition, p.manage_stock)
        OR (p.has_variants IS NOT TRUE
          AND coalesce(discovery.canonical_product_condition(p.condition), 'new') = requested.condition))
  ),
  best AS (
    -- One row per product: the cap measures candidate products, so one
    -- variant-heavy product cannot evict the rest. Acceptance first keeps
    -- the loader's product decision exact; purchasable ranks ahead within
    -- a class (hydration discards sold-out rows). Exclusion ranks
    -- outer-only; joint tiers pick the representative first.
    SELECT DISTINCT ON (eligible.product_id)
      eligible.product_id, eligible.attributes, eligible.is_accepted,
      eligible.is_purchasable, eligible.identity_excluded,
      eligible.complete_alternative_count, eligible.clear_branch_count,
      eligible.complete_branch_count, eligible.best_branch_exact
    FROM eligible
    ORDER BY eligible.product_id, (NOT eligible.is_accepted), (NOT eligible.is_purchasable),
      eligible.complete_alternative_count DESC, eligible.clear_branch_count DESC,
      eligible.complete_branch_count DESC, eligible.best_branch_exact DESC,
      eligible.created_at, eligible.id
  )
  SELECT best.product_id, best.attributes FROM best
  ORDER BY (NOT best.is_accepted), (NOT best.is_purchasable), best.identity_excluded,
    best.complete_alternative_count DESC, best.clear_branch_count DESC,
    best.complete_branch_count DESC, best.best_branch_exact DESC, best.product_id
  LIMIT least(greatest(coalesce(p_limit, 2000), 1), 2001)
  -- PostgREST clamps responses at 1,000 rows, so callers page below the
  -- cap and probe the window edge. Negative offsets clamp to page one.
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

ALTER FUNCTION public.search_product_variant_recall(uuid, jsonb, integer, integer, jsonb, jsonb, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.search_product_variant_recall(uuid, jsonb, integer, integer, jsonb, jsonb, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_product_variant_recall(uuid, jsonb, integer, integer, jsonb, jsonb, text, text, text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.search_product_variant_recall(uuid, jsonb, integer, integer, jsonb, jsonb, text, text, text) IS 'Published-merchant variant attributes for discovery recall; joint branch verdicts rank before attribute tiers; requested conditions narrow pre-cap; NULL merchant returns no rows.';
