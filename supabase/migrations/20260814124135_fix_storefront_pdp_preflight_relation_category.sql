-- Keep the proxy PDP preflight's category projection in parity with the
-- storefront PDP snapshot.  Products can retain an inactive/removed
-- products.category_id while their active public category lives in the
-- product_categories junction; the old preflight returned NULL in that case.
-- The streamed PDP then redirected to the active relation-backed category,
-- while the proxy preflight redirected the canonical category back to
-- /products/<slug>, producing a loop and a React Suspense boundary error.

-- Preserve the existing implementation as a private delegate so the public
-- RPC signature and generated client contract remain unchanged.
ALTER FUNCTION public.get_storefront_pdp_preflight(text, text)
  SET SCHEMA private;

REVOKE ALL ON FUNCTION private.get_storefront_pdp_preflight(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.get_storefront_pdp_preflight(text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_storefront_pdp_preflight(
  p_identifier text,
  p_product_slug text
)
RETURNS TABLE (
  storefront_status text,
  catalog_nonempty boolean,
  present boolean,
  match_kind text,
  product_id uuid,
  product_name text,
  product_slug text,
  product_category text,
  category_id uuid,
  category_name text,
  category_slug text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT
    base.storefront_status,
    base.catalog_nonempty,
    base.present,
    base.match_kind,
    base.product_id,
    base.product_name,
    base.product_slug,
    base.product_category,
    COALESCE(base.category_id, relation_category.id) AS category_id,
    COALESCE(base.category_name, relation_category.name) AS category_name,
    COALESCE(base.category_slug, relation_category.slug) AS category_slug
  FROM private.get_storefront_pdp_preflight(
    p_identifier,
    p_product_slug
  ) AS base
  LEFT JOIN LATERAL (
    SELECT
      joined_category.id,
      joined_category.name,
      joined_category.slug
    FROM public.product_categories AS membership
    JOIN public.products AS relation_product
      ON relation_product.id = membership.product_id
      AND relation_product.id = base.product_id
    JOIN public.categories AS joined_category
      ON joined_category.id = membership.category_id
      AND joined_category.is_active IS TRUE
      AND joined_category.merchant_id = relation_product.merchant_id
    WHERE relation_product.id = base.product_id
    ORDER BY membership.category_id
    LIMIT 1
  ) AS relation_category ON true;
$$;

COMMENT ON FUNCTION public.get_storefront_pdp_preflight(text, text) IS
  'Single-round-trip PDP preflight verdict with active relation-category fallback for proxy canonical parity.';

REVOKE ALL ON FUNCTION public.get_storefront_pdp_preflight(text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storefront_pdp_preflight(text, text)
  TO anon, authenticated, service_role;
