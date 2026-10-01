-- Identity-scoped variant recall ranking. The recall RPC ranked every
-- variant satisfying the attribute constraints equally, so for an intent
-- like phone AND storage_gb=256 (storage living only on variants), enough
-- wrong-identity 256 GB variants could fill the capped window ahead of the
-- valid phone with no product-level recovery. Alternatives now ride their
-- product type, brand, model, and compatibility identity into the RPC, and
-- identity-verified representatives rank ahead of contradicted ones. Ranking
-- stays fail-open like the matcher: missing product fields demote to the
-- middle tier instead of excluding, and an empty identity set is neutral.
-- The offset signature changes again, so the four-argument form is dropped
-- first: without this it would linger as a stale overload.
-- Canonical product type shared by stored and expected recall identity:
-- explicit metadata wins, else the storefront category map, mirroring the
-- matcher's productTypeOf (including its smartphones/laptops/tablets map)
-- so SQL ranking and post-hydration verdicts agree.
CREATE OR REPLACE FUNCTION discovery.canonical_identity_product_type(product_type text, category text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT CASE
    WHEN nullif(discovery.discovery_identity_normalize(product_type), '') IS NOT NULL
    THEN CASE discovery.discovery_identity_normalize(product_type)
      WHEN 'phone' THEN 'phone' WHEN 'phones' THEN 'phone'
      WHEN 'smartphone' THEN 'phone' WHEN 'smartphones' THEN 'phone'
      WHEN 'smart_phone' THEN 'phone' WHEN 'smart_phones' THEN 'phone'
      WHEN 'mobile_phone' THEN 'phone' WHEN 'mobile_phones' THEN 'phone'
      WHEN 'cell_phone' THEN 'phone' WHEN 'cell_phones' THEN 'phone'
      WHEN 'laptop' THEN 'laptop' WHEN 'laptops' THEN 'laptop'
      WHEN 'tablet' THEN 'tablet' WHEN 'tablets' THEN 'tablet'
      WHEN 'chargers' THEN 'charger' WHEN 'cables' THEN 'cable'
      WHEN 'security_cameras' THEN 'security_camera'
      WHEN 'fragrance_diffusers' THEN 'fragrance_diffuser'
      ELSE discovery.discovery_identity_normalize(product_type) END
    WHEN nullif(discovery.discovery_identity_normalize(category), '') = 'smartphones' THEN 'phone'
    WHEN nullif(discovery.discovery_identity_normalize(category), '') = 'laptops' THEN 'laptop'
    WHEN nullif(discovery.discovery_identity_normalize(category), '') = 'tablets' THEN 'tablet'
  END;
$$;

DROP FUNCTION IF EXISTS public.search_product_variant_recall(uuid, jsonb, integer, integer);
CREATE OR REPLACE FUNCTION public.search_product_variant_recall(
  p_merchant_id uuid,
  p_filters jsonb DEFAULT '[]'::jsonb,
  p_limit integer DEFAULT 2000,
  p_offset integer DEFAULT 0,
  p_identity jsonb DEFAULT '[]'::jsonb
) RETURNS TABLE (product_id uuid, attributes jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  -- Anonymous-executable boundary: cap the filter set before expansion, or a
  -- raw caller bypassing the MCP schema could force unbounded regex/parse
  -- CPU across the merchant's variant catalog. The loader never exceeds 50
  -- constraints (5 alternatives × 10 attributes, ~8KB worst case).
  IF pg_catalog.jsonb_typeof(p_filters) = 'array'
    AND (pg_catalog.jsonb_array_length(p_filters) > 50
      OR pg_catalog.octet_length(p_filters::text) > 16384) THEN
    RAISE EXCEPTION 'variant recall accepts at most 50 constraints'
      USING ERRCODE = '22023';
  END IF;
  -- Same boundary for identity: at most one entry per alternative, sized
  -- for the schema maximum (5 branches with 10 brands each, ~27KB worst
  -- case at full-width Unicode).
  IF pg_catalog.jsonb_typeof(p_identity) = 'array'
    AND (pg_catalog.jsonb_array_length(p_identity) > 5
      OR pg_catalog.octet_length(p_identity::text) > 32768) THEN
    RAISE EXCEPTION 'variant recall accepts identity for at most 5 branches'
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH filters AS (
    -- Normalize once: a non-array boundary value means no filtering, and
    -- the CASE keeps array expansion away from values that would error.
    -- Branch identity survives per filter: alternatives are OR branches, so
    -- ranking must score each branch separately instead of counting over the
    -- flattened set. A malformed branch falls back to group zero (fail open).
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
    -- Per-branch specified identity, normalized once: a non-array boundary
    -- value means no identity ranking, and the CASE keeps array expansion
    -- away from values that would error. Malformed branches fall back to
    -- group zero (fail open), mirroring filters. Expected types route
    -- through the same canonicalizer as stored types so a direct caller
    -- sending a raw alias still compares canonically.
    SELECT
      CASE WHEN identity_element.value ->> 'branch' ~ '^-?[0-9]{1,9}$'
        THEN (identity_element.value ->> 'branch')::integer
        ELSE 0
      END AS branch,
      discovery.canonical_identity_product_type(identity_element.value ->> 'product_type', NULL) AS product_type,
      (SELECT coalesce(pg_catalog.array_agg(DISTINCT brand.norm), '{}'::text[])
       FROM (SELECT nullif(discovery.discovery_identity_normalize(brand_elem), '') AS norm
             FROM pg_catalog.jsonb_array_elements_text(
               CASE WHEN pg_catalog.jsonb_typeof(identity_element.value -> 'brands') = 'array'
               THEN identity_element.value -> 'brands' ELSE '[]'::jsonb END) AS brand_elem) AS brand
       WHERE brand.norm IS NOT NULL) AS brands,
      nullif(discovery.discovery_identity_normalize(identity_element.value ->> 'model'), '') AS model,
      nullif(discovery.discovery_identity_normalize(identity_element.value ->> 'compatible_with'), '') AS compatible_with
    FROM pg_catalog.jsonb_array_elements(
      CASE WHEN pg_catalog.jsonb_typeof(p_identity) = 'array' THEN p_identity ELSE '[]'::jsonb END
    ) AS identity_element
  ),
  merchant_branches AS (
    -- Branch scope for serialized availability mirrors the public counts
    -- RPC with no branch context: a single active branch counts its units
    -- plus unassigned ones, otherwise only unassigned units count.
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
      -- Branch-grouped exactness, not a flattened count: a hybrid matching
      -- one constraint from each of two branches must not tie a variant
      -- completing one branch, or hybrids flood the cap ahead of the only
      -- valid variant-only product. Complete branches rank first, then the
      -- best per-branch exact count.
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
      -- Identity verdicts mirror the matcher's alternative evaluation: a
      -- branch completes when every specified field verifies, and stays
      -- clear while none contradicts. Missing product fields demote to the
      -- middle tier (fail open); an identity-less branch completes
      -- vacuously, exactly like the matcher.
      EXISTS (SELECT 1 FROM identity AS idn
        WHERE (idn.product_type IS NULL OR stored.product_type = idn.product_type)
          AND (idn.brands = '{}' OR stored.brand = ANY (idn.brands))
          AND (idn.model IS NULL OR stored.model = idn.model)
          AND (idn.compatible_with IS NULL OR stored.compatible_with @> ARRAY[idn.compatible_with])
      ) AS identity_complete,
      EXISTS (SELECT 1 FROM identity AS idn
        WHERE (idn.product_type IS NULL OR stored.product_type IS NULL OR stored.product_type = idn.product_type)
          AND (idn.brands = '{}' OR stored.brand IS NULL OR stored.brand = ANY (idn.brands))
          AND (idn.model IS NULL OR stored.model IS NULL OR stored.model = idn.model)
          AND (idn.compatible_with IS NULL OR stored.compatible_with = '{}'
            OR stored.compatible_with @> ARRAY[idn.compatible_with])
      ) AS identity_clear,
      -- Effective purchasability mirrors the storefront projection: explicit
      -- variant policy wins, else a serialized product policy, else off.
      -- Serialized policies replace stored stock with public available
      -- units; serialized_then_unlimited stays purchasable at zero units.
      (p.manage_stock IS NOT TRUE
        OR policy.effective_policy = 'serialized_then_unlimited'
        OR (policy.effective_policy = 'serialized_strict' AND COALESCE(units.available, 0) > 0)
        OR (policy.effective_policy = 'off' AND COALESCE(pv.stock_quantity, 0) > 0)) AS is_purchasable
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
        nullif(discovery.discovery_identity_normalize(p.brand), '') AS brand,
        nullif(discovery.discovery_identity_normalize(meta.facts ->> 'model'), '') AS model,
        (SELECT coalesce(pg_catalog.array_agg(DISTINCT compat.norm), '{}'::text[])
         FROM (SELECT nullif(discovery.discovery_identity_normalize(compat_elem), '') AS norm
               FROM pg_catalog.jsonb_array_elements_text(
                 CASE WHEN pg_catalog.jsonb_typeof(meta.facts -> 'compatible_with') = 'array'
                 THEN meta.facts -> 'compatible_with' ELSE '[]'::jsonb END) AS compat_elem) AS compat
         WHERE compat.norm IS NOT NULL) AS compatible_with
    ) AS stored
    WHERE pv.merchant_id = p_merchant_id
      AND p.merchant_id = p_merchant_id
      AND p.status = 'active'
      AND pv.is_inventory_anchor IS NOT TRUE
      AND (
        COALESCE(m.is_published, FALSE) = TRUE
        OR COALESCE(m.is_platform_admin, FALSE) = TRUE
      )
      -- Recall OR: a variant survives when some constraint cannot rule it
      -- out, mirroring the loader.
      AND (
        NOT EXISTS (SELECT 1 FROM filters)
        OR EXISTS (
          SELECT 1 FROM filters
          WHERE NOT discovery.recall_variant_filter_verifiably_fails(pv.attributes, filters.filter)
        )
      )
  ),
  best AS (
    -- One row per product: the cap measures candidate products, so a single
    -- product with thousands of variants cannot evict every other product.
    -- Ordering by acceptance first preserves the loader's product decision
    -- exactly: the representative accepts iff some variant would. Within an
    -- acceptance class, purchasable representatives rank ahead: hydration
    -- discards sold-out variants, so sold-out products filling the cap would
    -- strand purchasable matches past it with no product-level recovery.
    -- Identity is product-level, so it cannot change the representative;
    -- it ranks in the outer select only. Within a purchasability class,
    -- identity-verified products rank first, then unverified ones, so
    -- wrong-identity variants cannot evict valid ones from the cap. Then
    -- variants completing an alternative rank first, then the best
    -- per-branch exact count, so complete multi-attribute matches outrank
    -- partial ones and cross-branch hybrids.
    SELECT DISTINCT ON (eligible.product_id)
      eligible.product_id, eligible.attributes, eligible.is_accepted,
      eligible.is_purchasable, eligible.identity_complete, eligible.identity_clear,
      eligible.complete_branch_count, eligible.best_branch_exact
    FROM eligible
    ORDER BY eligible.product_id, (NOT eligible.is_accepted), (NOT eligible.is_purchasable),
      eligible.complete_branch_count DESC, eligible.best_branch_exact DESC,
      eligible.created_at, eligible.id
  )
  SELECT best.product_id, best.attributes FROM best
  ORDER BY (NOT best.is_accepted), (NOT best.is_purchasable),
    (NOT best.identity_complete), (NOT best.identity_clear),
    best.complete_branch_count DESC, best.best_branch_exact DESC, best.product_id
  LIMIT least(greatest(coalesce(p_limit, 2000), 1), 2001)
  -- PostgREST clamps responses at 1,000 rows, so callers page below the cap
  -- and probe the window edge instead of requesting 2,001 rows that can
  -- never arrive complete. Negative offsets clamp to the first page.
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

ALTER FUNCTION public.search_product_variant_recall(uuid, jsonb, integer, integer, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.search_product_variant_recall(uuid, jsonb, integer, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_product_variant_recall(uuid, jsonb, integer, integer, jsonb) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.search_product_variant_recall(uuid, jsonb, integer, integer, jsonb) IS 'Published-merchant variant attributes for discovery recall; filters narrow before the cap, identity ranks before branch completeness; NULL merchant returns no rows.';
