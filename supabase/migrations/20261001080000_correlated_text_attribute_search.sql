-- disable-transaction
-- A key lexeme plus independent value lexemes can be sourced from different
-- parts of a document. Index a SHA-256 digest of each verified pair.
CREATE OR REPLACE FUNCTION public.product_discovery_search_document_v4(
  product_name text, product_brand text, product_category text,
  product_description text, facts jsonb
) RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT public.product_discovery_search_document_v3(
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

-- Build the replacement under a temporary name before switching the serving
-- RPC: on a retry after the switch, a serving v4 index already exists, and
-- dropping it first would force every discovery query through a full product
-- scan for the duration of the concurrent rebuild.
DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_correlated_search_idx_new;
CREATE INDEX CONCURRENTLY products_discovery_correlated_search_idx_new ON public.products USING gin
(public.product_discovery_search_document_v4(name, brand, category, description, discovery_metadata))
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
    AND public.product_discovery_search_document_v4(p.name, p.brand, p.category,
      p.description, p.discovery_metadata)
      @@ pg_catalog.to_tsquery('simple'::regconfig, query_text)
  ORDER BY pg_catalog.ts_rank(public.product_discovery_search_document_v4(p.name, p.brand,
      p.category, p.description, p.discovery_metadata),
    pg_catalog.to_tsquery('simple'::regconfig, query_text)) DESC, p.id
  LIMIT least(greatest(coalesce(result_limit, 100), 1), 100)
  OFFSET least(greatest(coalesce(result_offset, 0), 0), 500);
$$;
REVOKE ALL ON FUNCTION public.search_product_discovery_facts(uuid, text, integer, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_product_discovery_facts(uuid, text, integer, integer, text, text) TO anon, authenticated;

DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_keyed_search_idx;
-- Retire the pre-switch correlated build (a no-op on first run) and promote
-- the replacement to the canonical name.
DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_correlated_search_idx;
ALTER INDEX IF EXISTS public.products_discovery_correlated_search_idx_new RENAME TO products_discovery_correlated_search_idx;
