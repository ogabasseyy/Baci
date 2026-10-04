-- disable-transaction
-- Bare model-only intents must recall identities that exist only in metadata.
-- v7 retains all v6 facts and emits exact model aliases using only the stored
-- manufacturer, mirroring the final matcher without guessing brands/suffixes.
CREATE OR REPLACE FUNCTION discovery.product_discovery_search_document_v7(
  product_name text, product_brand text, product_category text,
  product_description text, facts jsonb
) RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT discovery.product_discovery_search_document_v6(
    product_name, product_brand, product_category, product_description, facts)
    || pg_catalog.to_tsvector('simple'::regconfig, coalesce((
      SELECT pg_catalog.string_agg(discovery.discovery_identity_lexeme('model', alias), ' ')
      FROM (VALUES (bare.model), (normalized.brand || ' ' || bare.model)) AS aliases(alias)
      WHERE normalized.brand IS NOT NULL AND normalized.brand <> ''
        AND bare.model IS NOT NULL AND bare.model <> ''
    ), ''))
  FROM (SELECT
    discovery.discovery_identity_matcher_normalize(product_brand) AS brand,
    discovery.discovery_identity_matcher_normalize(facts ->> 'model') AS model
  ) AS normalized
  CROSS JOIN LATERAL (SELECT CASE
    WHEN normalized.brand <> ''
      AND pg_catalog.starts_with(normalized.model, normalized.brand || ' ')
      THEN pg_catalog.substr(normalized.model, pg_catalog.char_length(normalized.brand) + 2)
    ELSE normalized.model
  END AS model) AS bare;
$$;
REVOKE ALL ON FUNCTION discovery.product_discovery_search_document_v7(text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION discovery.product_discovery_search_document_v7(text, text, text, text, jsonb) TO anon, authenticated, service_role;

-- Keep the existing serving index until the v7 replacement is built.
-- Recover a completed switch if a deployment resumes after the RPC changed.
DO $$
DECLARE
  replacement_valid boolean;
  rpc_serves_v7 boolean;
BEGIN
  SELECT i.indisvalid INTO replacement_valid
  FROM pg_catalog.pg_index AS i
  WHERE i.indexrelid = pg_catalog.to_regclass('public.products_discovery_model_alias_idx_new');
  SELECT pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
    'public.search_product_discovery_facts(uuid,text,integer,integer,text,text,text,jsonb)'))
    LIKE '%product_discovery_search_document_v7%' INTO rpc_serves_v7;
  IF COALESCE(replacement_valid, false) AND COALESCE(rpc_serves_v7, false) THEN
    IF pg_catalog.to_regclass('public.products_discovery_identity_search_idx') IS NOT NULL
      AND pg_catalog.to_regclass('public.products_discovery_model_alias_idx_stale') IS NULL THEN
      ALTER INDEX public.products_discovery_identity_search_idx
        RENAME TO products_discovery_model_alias_idx_stale;
    END IF;
    IF pg_catalog.to_regclass('public.products_discovery_identity_search_idx') IS NULL THEN
      ALTER INDEX public.products_discovery_model_alias_idx_new
        RENAME TO products_discovery_identity_search_idx;
    END IF;
  END IF;
END;
$$;
DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_model_alias_idx_new;
CREATE INDEX CONCURRENTLY products_discovery_model_alias_idx_new ON public.products USING gin
(discovery.product_discovery_search_document_v7(name, brand, category, description, discovery_metadata))
WHERE status = 'active';

-- Same signature, RLS, availability, publication filters and windows as v6.
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
            WHERE p.manage_stock IS FALSE OR COALESCE(o.stock_quantity, 0) > 0)
          OR anchor.policy = 'serialized_then_unlimited'
          OR (anchor.policy = 'serialized_strict' AND anchor.units > 0)
          OR (anchor.policy IS NULL
            AND (p.manage_stock IS FALSE OR COALESCE(p.stock_quantity, 0) > 0)))))
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
    AND discovery.product_discovery_search_document_v7(p.name, p.brand, p.category,
      p.description, p.discovery_metadata)
      @@ pg_catalog.to_tsquery('simple'::regconfig, query_text)
  ORDER BY pg_catalog.ts_rank(discovery.product_discovery_search_document_v7(p.name, p.brand,
      p.category, p.description, p.discovery_metadata),
    pg_catalog.to_tsquery('simple'::regconfig, query_text)) DESC, p.id
  LIMIT least(greatest(coalesce(result_limit, 100), 1), 100)
  OFFSET least(greatest(coalesce(result_offset, 0), 0), 500);
$$;

DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_identity_search_idx;
ALTER INDEX IF EXISTS public.products_discovery_model_alias_idx_new
  RENAME TO products_discovery_identity_search_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_model_alias_idx_stale;
