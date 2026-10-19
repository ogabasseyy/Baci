-- Unconstrained browse narrows brand/category server-side before the
-- 500-row window. The ILIKE predicates folded non-ASCII case per the
-- database locale while the post-hydration filter uses ASCII-only folding,
-- so rows the final filter rejects could fill the window and strand
-- genuine matches. The browse source reads through this RPC, which applies
-- the same ASCII-only substring comparison (translate, never lower)
-- before ordering and paging. Requested conditions narrow here too, with
-- the live variant/offer/base semantics. The projection matches
-- DISCOVERY_PRODUCT_PROJECTION exactly. The six-argument form is dropped
-- for the condition param (a missed overload makes calls ambiguous, 42725).
DROP FUNCTION IF EXISTS public.search_products_browse(uuid, text, text, text, integer, integer);
CREATE OR REPLACE FUNCTION public.search_products_browse(
  p_merchant_id uuid,
  p_brand text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_sort text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0,
  p_condition text DEFAULT NULL
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
  RETURN QUERY
  WITH requested AS (
    -- The requested condition canonicalizes once, mirroring hydration.
    SELECT discovery.canonical_product_condition(p_condition) AS condition
  )
  SELECT p.id, p.name, p.description, p.discovery_metadata, p.slug, p.price,
    p.compare_at_price, p.images, p.condition, p.condition_detail,
    p.available_conditions, p.has_condition_offers, p.brand, p.category,
    p.manage_stock, p.stock_quantity, p.has_variants,
    p.inventory_tracking_policy, p.updated_at, p.created_at
  FROM public.products AS p
  JOIN public.merchants AS m ON m.id = p.merchant_id
  CROSS JOIN requested AS requested
  WHERE p.merchant_id = p_merchant_id
    AND p.status = 'active'
    AND (
      COALESCE(m.is_published, FALSE) = TRUE
      OR COALESCE(m.is_platform_admin, FALSE) = TRUE
    )
    -- ASCII-only narrowing mirrors the post-hydration substring match
    -- (literal, case-insensitive over ASCII): rows failing here would be
    -- dropped downstream, so narrowing strands none.
    AND (NULLIF(p_brand, '') IS NULL
      OR pg_catalog.strpos(pg_catalog.translate(p.brand, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), pg_catalog.translate(NULLIF(p_brand, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')) > 0)
    AND (NULLIF(p_category, '') IS NULL
      OR pg_catalog.strpos(pg_catalog.translate(p.category, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), pg_catalog.translate(NULLIF(p_category, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')) > 0)
    -- Requested conditions narrow before paging with the live option
    -- semantics: a matching base, a matching variant (with the parent
    -- base fallback), or a selectable condition offer.
    AND (requested.condition IS NULL
      OR coalesce(discovery.canonical_product_condition(p.condition), 'new') = requested.condition
      OR EXISTS (SELECT 1 FROM public.product_variants AS v
        WHERE v.product_id = p.id
          AND v.is_inventory_anchor IS NOT TRUE
          AND coalesce(discovery.canonical_product_condition(v.condition),
            discovery.canonical_product_condition(p.condition), 'new') = requested.condition)
      OR discovery.condition_offer_selectable(p.id, p.has_variants, requested.condition))
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

ALTER FUNCTION public.search_products_browse(uuid, text, text, text, integer, integer, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.search_products_browse(uuid, text, text, text, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_products_browse(uuid, text, text, text, integer, integer, text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.search_products_browse(uuid, text, text, text, integer, integer, text) IS 'Published-merchant browse window with ASCII-only brand/category narrowing and condition narrowing before the cap.';
