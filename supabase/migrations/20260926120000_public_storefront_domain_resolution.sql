-- Narrow anonymous routing projections for the edge domain cache. These
-- functions intentionally expose only scalar mappings already observable from
-- storefront routes; they do not grant table access or relax RLS.

CREATE OR REPLACE FUNCTION public.resolve_storefront_domain_slug(
  p_domain text
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  WITH normalized_input AS (
    SELECT pg_catalog.lower(pg_catalog.btrim(p_domain)) AS domain
    WHERE p_domain IS NOT NULL
      AND pg_catalog.octet_length(p_domain) <= 254
      AND pg_catalog.btrim(p_domain) <> ''
  )
  SELECT merchant_row.slug::text
    FROM public.domains AS domain_row
    JOIN public.merchants AS merchant_row
      ON merchant_row.id = domain_row.merchant_id
    CROSS JOIN normalized_input AS input
    -- The normalized predicate preserves the existing partial expression-index
    -- shape; the exact comparison retains the cache's stored-value semantics.
    WHERE pg_catalog.lower(domain_row.domain) = input.domain
      AND domain_row.domain = input.domain
      AND domain_row.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.resolve_storefront_custom_domain(
  p_slug text
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  WITH normalized_input AS (
    SELECT pg_catalog.lower(pg_catalog.btrim(p_slug)) AS slug
    WHERE p_slug IS NOT NULL
      AND pg_catalog.octet_length(p_slug) <= 254
      AND pg_catalog.btrim(p_slug) <> ''
  ),
  eligible_domains AS (
    SELECT
      domain_row.domain::text AS domain,
      COALESCE(domain_row.is_primary, false) AS is_primary,
      pg_catalog.count(*) OVER () AS eligible_count
    FROM public.merchants AS merchant_row
    JOIN public.domains AS domain_row
      ON domain_row.merchant_id = merchant_row.id
    CROSS JOIN normalized_input AS input
    WHERE merchant_row.slug = input.slug
      AND domain_row.status = 'active'
      AND domain_row.domain_type IN ('custom', 'purchased')
  )
  SELECT eligible.domain
  FROM eligible_domains AS eligible
  WHERE eligible.is_primary
    OR eligible.eligible_count = 1
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.resolve_storefront_domain_slug(text) IS
  'Anonymous-safe scalar lookup from one active custom-domain hostname to its merchant slug.';
COMMENT ON FUNCTION public.resolve_storefront_custom_domain(text) IS
  'Anonymous-safe scalar lookup from one merchant slug to its authoritative active custom domain.';

REVOKE ALL ON FUNCTION public.resolve_storefront_domain_slug(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_storefront_custom_domain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_storefront_domain_slug(text)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_storefront_custom_domain(text)
  TO anon, authenticated;
