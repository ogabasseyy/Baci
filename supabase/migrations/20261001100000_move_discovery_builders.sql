-- disable-transaction
-- The document builders are index-expression helpers, not API functions: move
-- them out of the public (PostgREST-exposed) schema so anonymous callers
-- cannot invoke tokenization and SHA-256 work directly as RPCs. They live in
-- a dedicated discovery schema rather than private because the repair
-- delegates boundary forbids re-granting API roles USAGE on private, while
-- the SECURITY INVOKER serving query must evaluate the builders at rank time
-- as its caller.
CREATE SCHEMA IF NOT EXISTS discovery;

DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_correlated_search_idx;

ALTER FUNCTION public.product_discovery_search_document_v3(text, text, text, text, jsonb)
  SET SCHEMA discovery;
ALTER FUNCTION public.product_discovery_search_document_v4(text, text, text, text, jsonb)
  SET SCHEMA discovery;

-- v4's body references public.v3; repoint it after the move.
CREATE OR REPLACE FUNCTION discovery.product_discovery_search_document_v4(
  product_name text, product_brand text, product_category text,
  product_description text, facts jsonb
) RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT discovery.product_discovery_search_document_v3(
      product_name, product_brand, product_category, product_description, facts)
    || pg_catalog.to_tsvector('simple'::regconfig, CASE
      WHEN pg_catalog.jsonb_typeof(facts -> 'attributes') = 'object' THEN coalesce((
        SELECT pg_catalog.string_agg('fact' || pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to(pair.key || pg_catalog.chr(31) || pair.normalized_value, 'UTF8'),
            'sha256'), 'hex'), ' ')
        FROM (
          SELECT attribute.key,
            pg_catalog.lower(pg_catalog.normalize(
              pg_catalog.regexp_replace(
                pg_catalog.regexp_replace(
                  pg_catalog.normalize(attribute.value #>> '{}', 'NFC'),
                  '^[[:space:]]+|[[:space:]]+$', '', 'g'),
                '[[:space:]]+', ' ', 'g'), 'NFC')) AS normalized_value
          FROM pg_catalog.jsonb_each(facts -> 'attributes') AS attribute(key, value)
          WHERE attribute.key IN ('color', 'connector', 'processor', 'connectivity')
            AND pg_catalog.jsonb_typeof(attribute.value) = 'string'
            AND pg_catalog.btrim(attribute.value #>> '{}') <> ''
        ) AS pair
      ), '')
      ELSE ''
    END);
$$;

CREATE INDEX CONCURRENTLY products_discovery_correlated_search_idx ON public.products USING gin
(discovery.product_discovery_search_document_v4(name, brand, category, description, discovery_metadata))
WHERE status = 'active';

-- The serving RPC references public.v4; repoint it without changing the
-- signature, ranking, or grants.
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
    AND discovery.product_discovery_search_document_v4(p.name, p.brand, p.category,
      p.description, p.discovery_metadata)
      @@ pg_catalog.to_tsquery('simple'::regconfig, query_text)
  ORDER BY pg_catalog.ts_rank(discovery.product_discovery_search_document_v4(p.name, p.brand,
      p.category, p.description, p.discovery_metadata),
    pg_catalog.to_tsquery('simple'::regconfig, query_text)) DESC, p.id
  LIMIT least(greatest(coalesce(result_limit, 100), 1), 100)
  OFFSET least(greatest(coalesce(result_offset, 0), 0), 500);
$$;
REVOKE ALL ON FUNCTION public.search_product_discovery_facts(uuid, text, integer, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_product_discovery_facts(uuid, text, integer, integer, text, text) TO anon, authenticated;

GRANT USAGE ON SCHEMA discovery TO anon, authenticated;
