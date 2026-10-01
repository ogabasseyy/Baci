-- disable-transaction
-- Numeric equality retrieval must preserve the attribute name. A shared 8gb
-- lexeme lets RAM satisfy a storage query (and vice versa) before matching.
CREATE OR REPLACE FUNCTION public.product_discovery_search_document_v3(
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
      SELECT pg_catalog.string_agg(value || ' ' || unit || ' ' || value || unit || ' ' ||
        attribute_prefix || value || unit || ' ' || attribute_prefix || unit, ' ')
      FROM (
        SELECT pg_catalog.trim_scale((facts -> 'attributes' ->> key)::numeric)::text AS value,
          unit, attribute_prefix
        FROM (VALUES
          ('storage_gb', 'GB', 'storage'), ('ram_gb', 'GB', 'ram'),
          ('power_w', 'W', 'power'), ('screen_inches', 'inch', 'screen'),
          ('refresh_hz', 'Hz', 'refresh')) AS units(key, unit, attribute_prefix)
        WHERE pg_catalog.jsonb_typeof(facts -> 'attributes' -> key) = 'number'
        UNION ALL
        SELECT pg_catalog.trim_scale((facts -> 'attributes' ->> key)::numeric / 1024)::text,
          'TB', attribute_prefix
        FROM (VALUES ('storage_gb', 'storage'), ('ram_gb', 'ram')) AS capacities(key, attribute_prefix)
        WHERE pg_catalog.jsonb_typeof(facts -> 'attributes' -> key) = 'number'
        UNION ALL
        SELECT pg_catalog.trim_scale((facts -> 'attributes' ->> key)::numeric * 1024)::text,
          'MB', attribute_prefix
        FROM (VALUES ('storage_gb', 'storage'), ('ram_gb', 'ram')) AS capacities(key, attribute_prefix)
        WHERE pg_catalog.jsonb_typeof(facts -> 'attributes' -> key) = 'number'
      ) AS values_with_units
    ), ''))
    -- Attribute keys are lexemes too, so a text constraint retrieves only
    -- documents carrying that key: color=black must not match a document
    -- that merely mentions black. Keys tokenize the same way as values.
    || pg_catalog.to_tsvector('simple'::regconfig,
      CASE WHEN pg_catalog.jsonb_typeof(facts -> 'attributes') = 'object'
      THEN coalesce((SELECT pg_catalog.string_agg(k, ' ')
        FROM pg_catalog.jsonb_object_keys(facts -> 'attributes') AS k), '')
      ELSE '' END);
$$;

-- Build the keyed replacement under a temporary name: on a retry after the
-- RPC switch, a serving v3 index already exists, and dropping it first would
-- force every discovery query through a full product scan for the duration of
-- the concurrent rebuild.
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
  WHERE c.oid = pg_catalog.to_regclass('public.products_discovery_keyed_search_idx_new');
  IF pg_catalog.to_regclass('public.products_discovery_keyed_search_idx') IS NULL
    AND COALESCE(replacement_serving, false) THEN
    ALTER INDEX public.products_discovery_keyed_search_idx_new RENAME TO products_discovery_keyed_search_idx;
  END IF;
END;
$$;
DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_keyed_search_idx_new;
CREATE INDEX CONCURRENTLY products_discovery_keyed_search_idx_new ON public.products USING gin
(public.product_discovery_search_document_v3(name, brand, category, description, discovery_metadata))
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
    AND public.product_discovery_search_document_v3(p.name, p.brand, p.category,
      p.description, p.discovery_metadata)
      @@ pg_catalog.to_tsquery('simple'::regconfig, query_text)
  ORDER BY pg_catalog.ts_rank(public.product_discovery_search_document_v3(p.name, p.brand,
      p.category, p.description, p.discovery_metadata),
    pg_catalog.to_tsquery('simple'::regconfig, query_text)) DESC, p.id
  LIMIT least(greatest(coalesce(result_limit, 100), 1), 100)
  OFFSET least(greatest(coalesce(result_offset, 0), 0), 500);
$$;
REVOKE ALL ON FUNCTION public.search_product_discovery_facts(uuid, text, integer, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_product_discovery_facts(uuid, text, integer, integer, text, text) TO anon, authenticated;

DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_capacity_search_idx;
-- Retire the pre-switch keyed build (a no-op on first run) and promote the
-- replacement to the canonical name.
DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_keyed_search_idx;
ALTER INDEX IF EXISTS public.products_discovery_keyed_search_idx_new RENAME TO products_discovery_keyed_search_idx;
