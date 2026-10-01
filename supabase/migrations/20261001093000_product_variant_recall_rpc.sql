-- Published-merchant variant recall for MCP discovery. Constraints filter
-- BEFORE the cap: ordering and limiting the whole variant table first would
-- strand a sole matching variant past the cap on large catalogs, and
-- product-level fact search cannot see variant attributes to recover it. The
-- WHERE clause mirrors the loader's matching as a recall superset (missing
-- keys, unparseable values, and malformed filters keep the row), and exact
-- matches order first so sparse keys cannot flood the window ahead of them.
-- The loader re-verifies precisely and the matcher enforces every constraint
-- post-hydration. Duplicate aliases resolve last-wins like the loader's
-- overwrite pass. The cap measures products (one representative row each),
-- and the filter set itself is bounded because this RPC is anonymously
-- executable. Purchasable representatives rank ahead of sold-out ones within
-- an acceptance class, so sold-out exact matches cannot fill the cap ahead
-- of purchasable matches hydration would keep. Matchers live in
-- 20261001090000, which always applies first.
CREATE OR REPLACE FUNCTION public.search_product_variant_recall(
  p_merchant_id uuid,
  p_filters jsonb DEFAULT '[]'::jsonb,
  p_limit integer DEFAULT 2000
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
  RETURN QUERY
  WITH filters AS (
    -- Normalize once: a non-array boundary value means no filtering, and
    -- the CASE keeps array expansion away from values that would error.
    SELECT filter_element.value AS filter
    FROM pg_catalog.jsonb_array_elements(
      CASE WHEN pg_catalog.jsonb_typeof(p_filters) = 'array' THEN p_filters ELSE '[]'::jsonb END
    ) AS filter_element
  ),
  eligible AS (
    SELECT pv.product_id, pv.attributes, pv.created_at, pv.id,
      EXISTS (SELECT 1 FROM filters
        WHERE discovery.recall_variant_filter_exactly_matches(pv.attributes, filters.filter)) AS is_exact,
      EXISTS (SELECT 1 FROM filters
        WHERE discovery.recall_variant_filter_loader_accepts(pv.attributes, filters.filter)) AS is_accepted,
      -- Purchasability mirrors the loader's stock gate exactly: unmanaged
      -- products ignore variant stock, managed ones need positive stock.
      (p.manage_stock IS NOT TRUE OR COALESCE(pv.stock_quantity, 0) > 0) AS is_purchasable
    FROM public.product_variants AS pv
    JOIN public.products AS p ON p.id = pv.product_id
    JOIN public.merchants AS m ON m.id = p.merchant_id
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
    SELECT DISTINCT ON (eligible.product_id)
      eligible.product_id, eligible.attributes, eligible.is_accepted,
      eligible.is_purchasable, eligible.is_exact
    FROM eligible
    ORDER BY eligible.product_id, (NOT eligible.is_accepted), (NOT eligible.is_purchasable),
      (NOT eligible.is_exact), eligible.created_at, eligible.id
  )
  SELECT best.product_id, best.attributes FROM best
  ORDER BY (NOT best.is_accepted), (NOT best.is_purchasable), (NOT best.is_exact), best.product_id
  LIMIT least(greatest(coalesce(p_limit, 2000), 1), 2001);
END;
$$;

ALTER FUNCTION public.search_product_variant_recall(uuid, jsonb, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.search_product_variant_recall(uuid, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_product_variant_recall(uuid, jsonb, integer) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.search_product_variant_recall(uuid, jsonb, integer) IS 'Published-merchant variant attributes for discovery recall; filters narrow before the cap; NULL merchant returns no rows.';
