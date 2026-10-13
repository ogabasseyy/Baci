-- Identity-scoped variant recall ranking. Alternatives ride their product
-- identity into the RPC, and representatives rank by per-branch JOINT
-- verdicts: full-alternative branches first, then clear branches, so hybrids
-- (identity from one alternative, attributes from another) sink below valid
-- and unverified products. Verified excluded types sink below every
-- non-excluded row. Ranking stays fail-open: missing fields demote, never
-- exclude. Stored and expected types route through the product-type
-- canonicalizer defined in 20261001110000, so SQL ranking and post-hydration
-- verdicts agree. Requested conditions narrow before the cap with the live
-- variant/offer/base semantics, so matching options are not crowded out by
-- other-condition rows. The eight-argument form is dropped for the
-- condition param (a missed overload makes short calls ambiguous, 42725).
DROP FUNCTION IF EXISTS public.search_product_variant_recall(uuid, jsonb, integer, integer, jsonb, jsonb, text, text);
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
  -- Anonymous-executable boundary: cap filters before expansion, or a raw
  -- caller could force unbounded parse CPU (loader max: 50, ~8KB).
  IF pg_catalog.jsonb_typeof(p_filters) = 'array'
    AND (pg_catalog.jsonb_array_length(p_filters) > 50
      OR pg_catalog.octet_length(p_filters::text) > 16384) THEN
    RAISE EXCEPTION 'variant recall accepts at most 50 constraints'
      USING ERRCODE = '22023';
  END IF;
  -- Same boundary for identity: one entry per alternative, sized for the
  -- schema maximum (5 branches with 10 brands, ~27KB worst case).
  IF pg_catalog.jsonb_typeof(p_identity) = 'array'
    AND (pg_catalog.jsonb_array_length(p_identity) > 5
      OR pg_catalog.octet_length(p_identity::text) > 32768) THEN
    RAISE EXCEPTION 'variant recall accepts identity for at most 5 branches'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_typeof(p_excluded_types) = 'array'
    AND (pg_catalog.jsonb_array_length(p_excluded_types) > 10
      OR pg_catalog.octet_length(p_excluded_types::text) > 8192) THEN
    RAISE EXCEPTION 'variant recall accepts at most 10 excluded product types'
      USING ERRCODE = '22023';
  END IF;
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
  merchant_branches AS (
    -- Branch scope mirrors the public counts RPC: one active branch counts
    -- its units plus unassigned ones, otherwise only unassigned units count.
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
      -- Effective purchasability mirrors the storefront projection: explicit
      -- variant policy wins, else a serialized product policy, else off.
      -- Serialized policies read public available units; legacy NULL
      -- parents count as managed (IS FALSE), matching the storefront.
      ((policy.effective_policy = 'off'
          AND (p.manage_stock IS FALSE OR COALESCE(pv.stock_quantity, 0) > 0))
        OR policy.effective_policy = 'serialized_then_unlimited'
        OR (policy.effective_policy = 'serialized_strict' AND COALESCE(units.available, 0) > 0)) AS is_purchasable
    FROM public.product_variants AS pv
    JOIN public.products AS p ON p.id = pv.product_id
    JOIN public.merchants AS m ON m.id = p.merchant_id
    LEFT JOIN available_units AS units ON units.variant_id = pv.id
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN COALESCE(pv.inventory_tracking_policy, 'inherit') IN ('off', 'serialized_strict', 'serialized_then_unlimited')
          THEN COALESCE(pv.inventory_tracking_policy, 'inherit')
        WHEN COALESCE(p.inventory_tracking_policy, 'off') IN ('serialized_strict', 'serialized_then_unlimited')
          THEN p.inventory_tracking_policy
        ELSE 'off'
      END AS effective_policy
    ) AS policy
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
      -- canonical condition with the parent base fallback, an offer on
      -- its own canonical condition, and a variant-less parent on the
      -- base. Non-matching variants still qualify through a matching
      -- sibling offer, so offer-only products stay reachable.
      AND (NULLIF(p_condition, '') IS NULL
        OR coalesce(discovery.canonical_product_condition(pv.condition),
          discovery.canonical_product_condition(p.condition), 'new') = NULLIF(p_condition, '')
        OR EXISTS (SELECT 1 FROM public.product_offers AS o
          WHERE o.product_id = p.id
            AND discovery.canonical_product_condition(o.condition) = NULLIF(p_condition, ''))
        OR (p.has_variants IS NOT TRUE
          AND coalesce(discovery.canonical_product_condition(p.condition), 'new') = NULLIF(p_condition, '')))
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
