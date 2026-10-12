-- disable-transaction
-- v4 used locale-sensitive pg_catalog.lower for text-attribute digests, but
-- discovery verification uses the shared NFC/ASCII/JS-whitespace normalizer.
-- Rebuild from v3 so no stale v4 digest can admit a false match, then retain
-- v5's exact identity lexemes and numeric facts.
-- Type lexemes digest normalized values that contain punctuation or non-ASCII
-- characters, preventing distinct values from colliding after ASCII cleanup.
CREATE OR REPLACE FUNCTION discovery.discovery_identity_lexeme_v6(tag text, raw text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT CASE
    WHEN tag IN ('brand', 'model', 'compat') THEN
      discovery.discovery_identity_lexeme(tag, raw)
    WHEN normalized IS NULL OR normalized = '' THEN NULL
    WHEN cleaned <> normalized OR pg_catalog.char_length(cleaned) > 64
      THEN 'fact' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        tag || pg_catalog.chr(31) || normalized, 'UTF8'), 'sha256'), 'hex')
    ELSE tag || cleaned
  END
  FROM (SELECT discovery.discovery_identity_normalize(raw) AS normalized) AS input,
    LATERAL (SELECT pg_catalog.regexp_replace(normalized, '[^a-z0-9_]', '', 'g') AS cleaned) AS stripped;
$$;

CREATE OR REPLACE FUNCTION discovery.product_discovery_search_document_v6(
  product_name text, product_brand text, product_category text,
  product_description text, facts jsonb
) RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT discovery.product_discovery_search_document_v3(
      product_name, product_brand, product_category, product_description, facts)
    || pg_catalog.to_tsvector('simple'::regconfig, coalesce((
      SELECT pg_catalog.string_agg('fact' || pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(
          pair.key || pg_catalog.chr(31) || pair.normalized_value, 'UTF8'), 'sha256'), 'hex'), ' ')
      FROM (
        SELECT attribute.key,
          nullif(discovery.discovery_identity_matcher_normalize(
            attribute.value #>> '{}'), '') AS normalized_value
        FROM pg_catalog.jsonb_each(
          CASE WHEN pg_catalog.jsonb_typeof(facts -> 'attributes') = 'object'
            THEN facts -> 'attributes' ELSE '{}'::jsonb END) AS attribute(key, value)
        WHERE attribute.key IN ('color', 'connector', 'processor', 'connectivity')
          AND pg_catalog.jsonb_typeof(attribute.value) = 'string'
      ) AS pair
      WHERE pair.normalized_value IS NOT NULL
    ), ''))
    || pg_catalog.to_tsvector('simple'::regconfig, coalesce((
      SELECT pg_catalog.string_agg(lexeme, ' ')
      FROM (
        SELECT discovery.discovery_identity_lexeme_v6('type',
          discovery.canonical_identity_product_type(
            facts ->> 'product_type', product_category)) AS lexeme
        UNION ALL
        SELECT discovery.discovery_identity_lexeme('brand', product_brand)
        UNION ALL
        SELECT discovery.discovery_identity_lexeme('model', facts ->> 'model')
        UNION ALL
        SELECT discovery.discovery_identity_lexeme('compat', elem)
        FROM pg_catalog.jsonb_array_elements_text(
          CASE WHEN pg_catalog.jsonb_typeof(facts -> 'compatible_with') = 'array'
            THEN facts -> 'compatible_with' ELSE '[]'::jsonb END) AS elem
      ) AS lexemes
      WHERE lexeme IS NOT NULL
    ), ''));
$$;

-- Keep the v5 serving index until the replacement is complete. The temporary
-- index is planner-usable during the RPC switch and while the old name moves.
DO $$
DECLARE
  replacement_serving boolean;
  rpc_serves_v6 boolean;
BEGIN
  SELECT i.indisvalid INTO replacement_serving
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_index AS i ON i.indexrelid = c.oid
  WHERE c.oid = pg_catalog.to_regclass('public.products_discovery_ascii_search_idx_new');
  SELECT pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.search_product_discovery_facts(uuid,text,integer,integer,text,text,text,jsonb)'))
      LIKE '%product_discovery_search_document_v6%' INTO rpc_serves_v6;
  IF COALESCE(replacement_serving, false) AND COALESCE(rpc_serves_v6, false) THEN
    IF pg_catalog.to_regclass('public.products_discovery_identity_search_idx') IS NOT NULL
      AND pg_catalog.to_regclass('public.products_discovery_identity_search_idx_stale') IS NULL THEN
      ALTER INDEX public.products_discovery_identity_search_idx
        RENAME TO products_discovery_identity_search_idx_stale;
    END IF;
    IF pg_catalog.to_regclass('public.products_discovery_identity_search_idx') IS NULL THEN
      ALTER INDEX public.products_discovery_ascii_search_idx_new
        RENAME TO products_discovery_identity_search_idx;
    END IF;
  ELSIF pg_catalog.to_regclass('public.products_discovery_identity_search_idx') IS NULL
    AND COALESCE(replacement_serving, false) THEN
    ALTER INDEX public.products_discovery_ascii_search_idx_new
      RENAME TO products_discovery_identity_search_idx;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION discovery.discovery_identity_lexeme_v6(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION discovery.discovery_identity_lexeme_v6(text, text) TO anon, authenticated, service_role;
DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_ascii_search_idx_new;
CREATE INDEX CONCURRENTLY products_discovery_ascii_search_idx_new ON public.products USING gin
(discovery.product_discovery_search_document_v6(name, brand, category, description, discovery_metadata))
WHERE status = 'active';

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
  -- Anchor-resolved base policy rides one row per product (NULL policy
  -- means off: the anchor RPC returns serialized rows only). Variant
  -- products skip the RPC: their policy resolves per variant below.
  CROSS JOIN LATERAL (
    SELECT
      CASE WHEN p.has_variants IS NOT TRUE
        THEN (SELECT a.effective_policy
          FROM public.get_mcp_search_serialized_anchor_policies(ARRAY[p.id], merchant_id_param) AS a
          LIMIT 1) END AS policy,
      CASE WHEN p.has_variants IS NOT TRUE
        THEN COALESCE((SELECT a.available_units
          FROM public.get_mcp_search_serialized_anchor_policies(ARRAY[p.id], merchant_id_param) AS a
          LIMIT 1), 0)
        ELSE 0 END AS units
  ) AS anchor
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
    -- Live-option availability gates every mode: a purchasable variant
    -- under the effective policy and stock rules (the projection already
    -- resolves serialized stock to public available units), or a
    -- servable variantless base (live offer, anchor-resolved serialized
    -- policy, or unmanaged/stocked parent under off).
    AND (EXISTS (SELECT 1
        FROM public.get_mcp_search_product_variants(ARRAY[p.id], merchant_id_param) AS v
        WHERE v.effective_policy = 'serialized_then_unlimited'
          OR (v.effective_policy = 'off'
            AND (p.manage_stock IS FALSE OR v.stock_quantity > 0))
          OR (v.effective_policy = 'serialized_strict' AND v.stock_quantity > 0))
      OR (p.has_variants IS NOT TRUE
        AND (EXISTS (SELECT 1
            FROM public.get_mcp_search_product_offers(ARRAY[p.id], merchant_id_param) AS o
            WHERE p.manage_stock IS NOT TRUE OR COALESCE(o.stock_quantity, 0) > 0)
          OR anchor.policy = 'serialized_then_unlimited'
          OR (anchor.policy = 'serialized_strict' AND anchor.units > 0)
          OR (anchor.policy IS NULL
            AND (p.manage_stock IS NOT TRUE OR COALESCE(p.stock_quantity, 0) > 0)))))
    -- Snapshot-truncated parents never serve, so they filter before
    -- ranking instead of consuming it.
    AND (SELECT count(*)
      FROM public.get_mcp_search_product_variants(ARRAY[p.id], merchant_id_param)) < 129
    AND (requested.condition IS NULL
      OR (p.has_variants IS NOT TRUE
        AND coalesce(discovery.canonical_product_condition(p.condition), 'new') = requested.condition
        AND discovery.base_product_option_is_purchasable(p.id, merchant_id_param))
      OR discovery.product_condition_option_matches(p.id, p.has_variants,
        coalesce(discovery.canonical_product_condition(p.condition), 'new'), requested.condition,
        p.manage_stock))
    AND discovery.product_discovery_search_document_v6(p.name, p.brand, p.category,
      p.description, p.discovery_metadata)
      @@ pg_catalog.to_tsquery('simple'::regconfig, query_text)
  ORDER BY pg_catalog.ts_rank(discovery.product_discovery_search_document_v6(p.name, p.brand,
      p.category, p.description, p.discovery_metadata),
    pg_catalog.to_tsquery('simple'::regconfig, query_text)) DESC, p.id
  LIMIT least(greatest(coalesce(result_limit, 100), 1), 100)
  OFFSET least(greatest(coalesce(result_offset, 0), 0), 500);
$$;
REVOKE ALL ON FUNCTION discovery.product_discovery_search_document_v6(text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION discovery.product_discovery_search_document_v6(text, text, text, text, jsonb) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.search_product_discovery_facts(uuid, text, integer, integer, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_product_discovery_facts(uuid, text, integer, integer, text, text, text, jsonb) TO anon, authenticated;

DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_identity_search_idx;
ALTER INDEX IF EXISTS public.products_discovery_ascii_search_idx_new
  RENAME TO products_discovery_identity_search_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_identity_search_idx_stale;
