-- disable-transaction
-- Candidate retrieval may combine marketing words with verified facts. Only the
-- structured matcher may use verified facts to assert identity or specifications.
CREATE OR REPLACE FUNCTION public.product_discovery_search_document(
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
      ) AS values_with_units
    ), ''));
$$;

-- Build the replacement under a temporary name: on a retry after the RPC
-- switch, a serving combined index already exists, and dropping it first
-- would force every discovery query through a full product scan for the
-- duration of the concurrent rebuild.
-- A retry after an interruption between the RPC switch and the rename finds
-- the temporary index serving: promote a valid build to the canonical name
-- instead of dropping the only index matching the serving expression. An
-- invalid leftover is not serving, so it falls through to the rebuild below.
DO $$
DECLARE
  replacement_serving boolean;
BEGIN
  SELECT i.indisvalid INTO replacement_serving
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_index AS i ON i.indexrelid = c.oid
  WHERE c.oid = pg_catalog.to_regclass('public.products_discovery_combined_search_idx_new');
  IF pg_catalog.to_regclass('public.products_discovery_combined_search_idx') IS NULL
    AND COALESCE(replacement_serving, false) THEN
    ALTER INDEX public.products_discovery_combined_search_idx_new RENAME TO products_discovery_combined_search_idx;
  END IF;
END;
$$;
DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_combined_search_idx_new;
CREATE INDEX CONCURRENTLY products_discovery_combined_search_idx_new ON public.products USING gin
(public.product_discovery_search_document(name, brand, category, description, discovery_metadata))
WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.search_product_discovery_facts(
  merchant_id_param uuid, query_text text,
  result_limit integer DEFAULT 100, result_offset integer DEFAULT 0
) RETURNS TABLE (product_id uuid, total_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT p.id, count(*) OVER () FROM public.products p
  WHERE p.merchant_id = merchant_id_param AND p.status = 'active'
    AND public.product_discovery_search_document(p.name, p.brand, p.category,
      p.description, p.discovery_metadata)
      @@ pg_catalog.plainto_tsquery('simple'::regconfig, left(query_text, 100))
  ORDER BY p.id
  LIMIT least(greatest(coalesce(result_limit, 100), 1), 100)
  OFFSET least(greatest(coalesce(result_offset, 0), 0), 500);
$$;
REVOKE ALL ON FUNCTION public.search_product_discovery_facts(uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_product_discovery_facts(uuid, text, integer, integer) TO anon, authenticated;

DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_fact_search_idx;
-- Retire the pre-switch combined build (a no-op on first run) and promote
-- the replacement to the canonical name.
DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_combined_search_idx;
ALTER INDEX IF EXISTS public.products_discovery_combined_search_idx_new RENAME TO products_discovery_combined_search_idx;
