-- disable-transaction
-- Identity constraints (type, brand, model, compatibility) matched the
-- combined marketing vector, so hundreds of accessories mentioning 'phone'
-- could fill the capped fact window before the actual phone loads. Index
-- key-specific identity lexemes derived from the same authoritative fields
-- the matcher verifies, so the capped window fills with identity matches.
CREATE OR REPLACE FUNCTION discovery.discovery_identity_normalize(raw text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT pg_catalog.regexp_replace(
    pg_catalog.lower(pg_catalog.normalize(
      pg_catalog.regexp_replace(raw, '^[[:space:]]+|[[:space:]]+$', '', 'g'), 'NFKC')),
    '[[:space:]-]+', '_', 'g');
$$;

CREATE OR REPLACE FUNCTION discovery.discovery_identity_key(raw text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT nullif(pg_catalog.regexp_replace(
    discovery.discovery_identity_normalize(raw), '[^a-z0-9_]', '', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION discovery.product_discovery_search_document_v5(
  product_name text, product_brand text, product_category text,
  product_description text, facts jsonb
) RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT discovery.product_discovery_search_document_v4(
      product_name, product_brand, product_category, product_description, facts)
    || pg_catalog.to_tsvector('simple'::regconfig, coalesce((
      SELECT pg_catalog.string_agg(lexeme, ' ')
      FROM (
        SELECT 'type' || nullif(pg_catalog.regexp_replace(canonical_type, '[^a-z0-9_]', '', 'g'), '') AS lexeme
        FROM (SELECT CASE
          WHEN nullif(pg_catalog.lower(pg_catalog.normalize(
              pg_catalog.regexp_replace(
                pg_catalog.regexp_replace(
                  pg_catalog.normalize(facts ->> 'product_type', 'NFC'),
                  '^[[:space:]]+|[[:space:]]+$', '', 'g'),
                '[[:space:]]+', ' ', 'g'), 'NFC')), '') IS NOT NULL
          THEN CASE discovery.discovery_identity_normalize(facts ->> 'product_type')
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
            ELSE discovery.discovery_identity_normalize(facts ->> 'product_type') END
          WHEN pg_catalog.lower(pg_catalog.normalize(
              pg_catalog.regexp_replace(
                pg_catalog.regexp_replace(
                  pg_catalog.normalize(product_category, 'NFC'),
                  '^[[:space:]]+|[[:space:]]+$', '', 'g'),
                '[[:space:]]+', ' ', 'g'), 'NFC')) = 'smartphones' THEN 'phone'
          WHEN pg_catalog.lower(pg_catalog.normalize(
              pg_catalog.regexp_replace(
                pg_catalog.regexp_replace(
                  pg_catalog.normalize(product_category, 'NFC'),
                  '^[[:space:]]+|[[:space:]]+$', '', 'g'),
                '[[:space:]]+', ' ', 'g'), 'NFC')) = 'laptops' THEN 'laptop'
          WHEN pg_catalog.lower(pg_catalog.normalize(
              pg_catalog.regexp_replace(
                pg_catalog.regexp_replace(
                  pg_catalog.normalize(product_category, 'NFC'),
                  '^[[:space:]]+|[[:space:]]+$', '', 'g'),
                '[[:space:]]+', ' ', 'g'), 'NFC')) = 'tablets' THEN 'tablet'
        END AS canonical_type) AS typed
        UNION ALL
        SELECT 'brand' || discovery.discovery_identity_key(product_brand)
        UNION ALL
        SELECT 'model' || discovery.discovery_identity_key(facts ->> 'model')
        UNION ALL
        SELECT 'compat' || discovery.discovery_identity_key(elem)
        FROM pg_catalog.jsonb_array_elements_text(
          CASE WHEN pg_catalog.jsonb_typeof(facts -> 'compatible_with') = 'array'
          THEN facts -> 'compatible_with' ELSE '[]'::jsonb END) AS elem
      ) AS lexemes
      WHERE lexeme IS NOT NULL
    ), ''));
$$;

-- Build the replacement before switching the serving RPC; preserve v4 until
-- the new index is available.
DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_identity_search_idx;
CREATE INDEX CONCURRENTLY products_discovery_identity_search_idx ON public.products USING gin
(discovery.product_discovery_search_document_v5(name, brand, category, description, discovery_metadata))
WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.search_product_discovery_facts(
  merchant_id_param uuid, query_text text,
  result_limit integer DEFAULT 100, result_offset integer DEFAULT 0,
  brand_filter text DEFAULT NULL, category_filter text DEFAULT NULL
) RETURNS TABLE (product_id uuid, total_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT p.id, count(*) OVER () FROM public.products p
  WHERE p.merchant_id = merchant_id_param AND p.status = 'active'
    AND pg_catalog.char_length(query_text) <= 16000
    AND (brand_filter IS NULL OR pg_catalog.strpos(
      pg_catalog.lower(p.brand), pg_catalog.lower(brand_filter)) > 0)
    AND (category_filter IS NULL OR pg_catalog.strpos(
      pg_catalog.lower(p.category), pg_catalog.lower(category_filter)) > 0)
    AND discovery.product_discovery_search_document_v5(p.name, p.brand, p.category,
      p.description, p.discovery_metadata)
      @@ pg_catalog.to_tsquery('simple'::regconfig, query_text)
  ORDER BY pg_catalog.ts_rank(discovery.product_discovery_search_document_v5(p.name, p.brand,
      p.category, p.description, p.discovery_metadata),
    pg_catalog.to_tsquery('simple'::regconfig, query_text)) DESC, p.id
  LIMIT least(greatest(coalesce(result_limit, 100), 1), 100)
  OFFSET least(greatest(coalesce(result_offset, 0), 0), 500);
$$;
REVOKE ALL ON FUNCTION public.search_product_discovery_facts(uuid, text, integer, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_product_discovery_facts(uuid, text, integer, integer, text, text) TO anon, authenticated;

DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_correlated_search_idx;
