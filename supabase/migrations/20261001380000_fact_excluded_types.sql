-- Fact retrieval excluded product types. Fact-only intents ignored
-- intent-level exclusions, so an excluded type could fill the ranked fact
-- window with rows hydration rejects while a valid match sat past the cap.
-- Exclusions now filter before ranking with the same canonical
-- product-type test browse uses; under a nonempty exclusion list
-- unknown-type rows drop too (the matcher never selects them). The
-- argument rides the same element and byte bound, fail-closed like the
-- other fact filters. The seven-argument form is dropped for the excluded
-- types param (a missed overload makes calls ambiguous, 42725).
DROP FUNCTION IF EXISTS public.search_product_discovery_facts(uuid, text, integer, integer, text, text, text);
CREATE OR REPLACE FUNCTION public.search_product_discovery_facts(
  merchant_id_param uuid, query_text text,
  result_limit integer DEFAULT 100, result_offset integer DEFAULT 0,
  brand_filter text DEFAULT NULL, category_filter text DEFAULT NULL,
  condition_filter text DEFAULT NULL, excluded_types_filter jsonb DEFAULT '[]'::jsonb
) RETURNS TABLE (product_id uuid, total_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  WITH requested AS (
    SELECT discovery.canonical_product_condition(condition_filter) AS condition
  ),
  excluded_types AS (
    SELECT coalesce(array_agg(DISTINCT discovery.canonical_identity_product_type(elem, NULL))
      FILTER (WHERE discovery.canonical_identity_product_type(elem, NULL) IS NOT NULL),
      '{}'::text[]) AS types
    FROM pg_catalog.jsonb_array_elements_text(
      CASE WHEN pg_catalog.jsonb_typeof(excluded_types_filter) = 'array' THEN excluded_types_filter ELSE '[]'::jsonb END
    ) AS elem
  )
  SELECT p.id, count(*) OVER () FROM public.products p
  CROSS JOIN requested AS requested
  CROSS JOIN excluded_types AS excluded
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN pg_catalog.jsonb_typeof(p.discovery_metadata) = 'object' THEN p.discovery_metadata
      ELSE '{}'::jsonb
    END AS facts
  ) AS meta
  CROSS JOIN LATERAL (
    SELECT discovery.canonical_identity_product_type(meta.facts ->> 'product_type', p.category) AS product_type
  ) AS stored
  WHERE p.merchant_id = merchant_id_param AND p.status = 'active'
    AND pg_catalog.char_length(query_text) <= 16000
    AND (brand_filter IS NULL OR pg_catalog.char_length(brand_filter) <= 50)
    AND (category_filter IS NULL OR pg_catalog.char_length(category_filter) <= 50)
    AND (condition_filter IS NULL OR pg_catalog.char_length(condition_filter) <= 50)
    AND (excluded_types_filter IS NULL
      OR pg_catalog.jsonb_typeof(excluded_types_filter) <> 'array'
      OR (pg_catalog.jsonb_array_length(excluded_types_filter) <= 10
        AND pg_catalog.octet_length(excluded_types_filter::text) <= 8192))
    AND (excluded.types = '{}'::text[]
      OR (stored.product_type IS NOT NULL
        AND NOT (stored.product_type = ANY (excluded.types))))
    AND (brand_filter IS NULL OR pg_catalog.strpos(
      pg_catalog.translate(p.brand, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), pg_catalog.translate(brand_filter, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')) > 0)
    AND (category_filter IS NULL OR pg_catalog.strpos(
      pg_catalog.translate(p.category, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), pg_catalog.translate(category_filter, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')) > 0)
    AND (requested.condition IS NULL
      OR (p.has_variants IS NOT TRUE
        AND coalesce(discovery.canonical_product_condition(p.condition), 'new') = requested.condition)
      OR discovery.product_condition_option_matches(p.id, p.has_variants,
        coalesce(discovery.canonical_product_condition(p.condition), 'new'), requested.condition,
        p.manage_stock))
    AND discovery.product_discovery_search_document_v5(p.name, p.brand, p.category,
      p.description, p.discovery_metadata)
      @@ pg_catalog.to_tsquery('simple'::regconfig, query_text)
  ORDER BY pg_catalog.ts_rank(discovery.product_discovery_search_document_v5(p.name, p.brand,
      p.category, p.description, p.discovery_metadata),
    pg_catalog.to_tsquery('simple'::regconfig, query_text)) DESC, p.id
  LIMIT least(greatest(coalesce(result_limit, 100), 1), 100)
  OFFSET least(greatest(coalesce(result_offset, 0), 0), 500);
$$;
REVOKE ALL ON FUNCTION public.search_product_discovery_facts(uuid, text, integer, integer, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_product_discovery_facts(uuid, text, integer, integer, text, text, text, jsonb) TO anon, authenticated;
