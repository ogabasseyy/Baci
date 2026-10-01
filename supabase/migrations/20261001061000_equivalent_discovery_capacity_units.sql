-- disable-transaction
-- Candidate retrieval may combine marketing words with verified facts. Only the
-- structured matcher may use verified facts to assert identity or specifications.
CREATE OR REPLACE FUNCTION public.product_discovery_search_document_v2(
  product_name text, product_brand text, product_category text,
  product_description text, facts jsonb
) RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT pg_catalog.to_tsvector('simple'::regconfig,
    coalesce(product_name, '') || ' ' || coalesce(product_brand, '') || ' ' ||
    coalesce(product_category, '') || ' ' || coalesce(product_description, ''))
    || pg_catalog.jsonb_to_tsvector('simple'::regconfig,
      coalesce(facts, '{}'::jsonb), '["string", "numeric"]'::jsonb)
    || pg_catalog.to_tsvector('simple'::regconfig, coalesce((
      SELECT pg_catalog.string_agg(value || ' ' || unit || ' ' || value || unit, ' ')
      FROM (
        SELECT pg_catalog.trim_scale((facts -> 'attributes' ->> key)::numeric)::text AS value, unit
        FROM (VALUES ('storage_gb', 'GB'), ('ram_gb', 'GB'), ('power_w', 'W'),
          ('screen_inches', 'inch'), ('refresh_hz', 'Hz')) AS units(key, unit)
        WHERE pg_catalog.jsonb_typeof(facts -> 'attributes' -> key) = 'number'
        UNION ALL
        SELECT pg_catalog.trim_scale((facts -> 'attributes' ->> key)::numeric / 1024)::text, 'TB'
        FROM (VALUES ('storage_gb'), ('ram_gb')) AS capacities(key)
        WHERE pg_catalog.jsonb_typeof(facts -> 'attributes' -> key) = 'number'
        UNION ALL
        SELECT pg_catalog.trim_scale((facts -> 'attributes' ->> key)::numeric * 1024)::text, 'MB'
        FROM (VALUES ('storage_gb'), ('ram_gb')) AS capacities(key)
        WHERE pg_catalog.jsonb_typeof(facts -> 'attributes' -> key) = 'number'
      ) AS values_with_units
    ), ''));
$$;

-- Clear only the replacement artifact on retry; keep the existing combined index
-- available until the new concurrent build and RPC switch have completed.
DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_capacity_search_idx;
CREATE INDEX CONCURRENTLY products_discovery_capacity_search_idx ON public.products USING gin
(public.product_discovery_search_document_v2(name, brand, category, description, discovery_metadata))
WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.search_product_discovery_facts(
  merchant_id_param uuid, query_text text,
  result_limit integer DEFAULT 100, result_offset integer DEFAULT 0
) RETURNS TABLE (product_id uuid, total_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  -- query_text carries tsquery syntax built from structured alternatives, so OR
  -- branches retrieve (websearch_to_tsquery ignores grouping parentheses)
  -- instead of requiring every token in one product. Rank by text relevance
  -- because callers treat array position as reciprocal rank. The builder caps
  -- emitted terms, so no truncation can split the syntax.
  SELECT p.id, count(*) OVER () FROM public.products p
  WHERE p.merchant_id = merchant_id_param AND p.status = 'active'
    AND public.product_discovery_search_document_v2(p.name, p.brand, p.category,
      p.description, p.discovery_metadata)
      @@ pg_catalog.to_tsquery('simple'::regconfig, query_text)
  ORDER BY pg_catalog.ts_rank(public.product_discovery_search_document_v2(p.name, p.brand,
      p.category, p.description, p.discovery_metadata),
    pg_catalog.to_tsquery('simple'::regconfig, query_text)) DESC, p.id
  LIMIT least(greatest(coalesce(result_limit, 100), 1), 100)
  OFFSET least(greatest(coalesce(result_offset, 0), 0), 500);
$$;
REVOKE ALL ON FUNCTION public.search_product_discovery_facts(uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_product_discovery_facts(uuid, text, integer, integer) TO anon, authenticated;

DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_combined_search_idx;
