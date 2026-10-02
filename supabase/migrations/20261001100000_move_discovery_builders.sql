-- disable-transaction
-- The document builders are index-expression helpers, not API functions: move
-- them out of the public (PostgREST-exposed) schema so anonymous callers
-- cannot invoke tokenization and SHA-256 work directly as RPCs. They live in
-- a dedicated discovery schema rather than private because the repair
-- delegates boundary forbids re-granting API roles USAGE on private, while
-- the SECURITY INVOKER serving query must evaluate the builders at rank time
-- as its caller.
--
-- service_role needs USAGE too: index maintenance evaluates the SECURITY
-- INVOKER builder as the writing role, so any role inserting or updating
-- active products must resolve the discovery schema.
--
-- The move is staged because this migration runs outside a transaction
-- (CREATE INDEX CONCURRENTLY): a failure between statements must never leave
-- the serving RPC pointing at a dropped builder. Stage 1 copies the builders
-- into discovery while the public originals keep serving; stage 2 switches
-- the index and RPC to the copies; stage 3 removes the originals. Every
-- statement is idempotent (CREATE OR REPLACE / IF EXISTS), so re-running the
-- file after a mid-migration failure converges on the same end state.
CREATE SCHEMA IF NOT EXISTS discovery;
GRANT USAGE ON SCHEMA discovery TO anon, authenticated, service_role;

-- Stage 1: copy the v3 builder; public.v3 keeps serving until stage 2.
-- Body is identical to 20261001070000_keyed_discovery_numeric_facts.sql.
CREATE OR REPLACE FUNCTION discovery.product_discovery_search_document_v3(
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

-- Stage 1: copy the v4 builder over the discovery v3 copy. Body is identical
-- to 20261001080000_correlated_text_attribute_search.sql except the inner
-- call, which targets the copy so the pair is self-contained.
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
                  '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g'),
                '[[:space:]   -     　﻿]+', ' ', 'g'), 'NFC')) AS normalized_value
          FROM pg_catalog.jsonb_each(facts -> 'attributes') AS attribute(key, value)
          WHERE attribute.key IN ('color', 'connector', 'processor', 'connectivity')
            AND pg_catalog.jsonb_typeof(attribute.value) = 'string'
            AND pg_catalog.regexp_replace(attribute.value #>> '{}', '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g') <> ''
        ) AS pair
      ), '')
      ELSE ''
    END);
$$;

-- Stage 2: build the discovery-backed replacement under a temporary name
-- while the serving v4 index stays available, so the RPC keeps its index
-- throughout the concurrent build (and after a failed build, on retry).
-- A retry after an interruption between the RPC switch and the rename finds
-- the temporary index serving: promote a valid build to the canonical name
-- instead of dropping the only index matching the serving expression. An
-- invalid leftover is not serving, so it falls through to the rebuild below.
-- When the canonical name still refers to the old public.v4 expression, a
-- valid replacement means the retry stopped after the RPC switch: the stale
-- canonical parks aside for the plain-statement drop below (CONCURRENTLY
-- cannot run inside DO) and the replacement promotes, so the serving RPC
-- keeps its index instead of full-scanning through a redundant rebuild. The
-- check reads pg_depend, not indexdef text, whose schema qualification
-- depends on the caller's search_path.
DO $$
DECLARE
  replacement_serving boolean;
BEGIN
  SELECT i.indisvalid INTO replacement_serving
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_index AS i ON i.indexrelid = c.oid
  WHERE c.oid = pg_catalog.to_regclass('public.products_discovery_correlated_search_idx_new');
  IF pg_catalog.to_regclass('public.products_discovery_correlated_search_idx') IS NULL THEN
    IF COALESCE(replacement_serving, false) THEN
      ALTER INDEX public.products_discovery_correlated_search_idx_new RENAME TO products_discovery_correlated_search_idx;
    END IF;
  ELSIF COALESCE(replacement_serving, false)
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_depend AS d
      WHERE d.objid = pg_catalog.to_regclass('public.products_discovery_correlated_search_idx')
        AND d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
        AND d.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
        AND d.refobjid = pg_catalog.to_regprocedure('public.product_discovery_search_document_v4(text, text, text, text, jsonb)')
    ) THEN
    ALTER INDEX public.products_discovery_correlated_search_idx RENAME TO products_discovery_correlated_search_idx_stale;
    ALTER INDEX public.products_discovery_correlated_search_idx_new RENAME TO products_discovery_correlated_search_idx;
  END IF;
END;
$$;
DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_correlated_search_idx_stale;
DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_correlated_search_idx_new;
CREATE INDEX CONCURRENTLY products_discovery_correlated_search_idx_new ON public.products USING gin
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

-- The repointed RPC resolves the replacement index, so drop the served
-- index and rename the replacement to the canonical name the v5 migration
-- expects when it drops the correlated index.
DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_correlated_search_idx;
ALTER INDEX IF EXISTS public.products_discovery_correlated_search_idx_new RENAME TO products_discovery_correlated_search_idx;

-- Stage 3: remove the public originals now that nothing references them.
-- v4 first: its body depends on v3.
DROP FUNCTION IF EXISTS public.product_discovery_search_document_v4(text, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.product_discovery_search_document_v3(text, text, text, text, jsonb);

-- The superseded v1/v2 builders are referenced by no index or RPC, so they
-- move atomically instead of the staged copy: there is no serving window to
-- protect, and any dependent would follow the move by OID. ALTER FUNCTION
-- has no IF EXISTS clause, so the move is guarded by to_regprocedure and a
-- retry skips functions that already moved.
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.product_discovery_search_document(text, text, text, text, jsonb)') IS NOT NULL THEN
    ALTER FUNCTION public.product_discovery_search_document(text, text, text, text, jsonb) SET SCHEMA discovery;
  END IF;
  IF pg_catalog.to_regprocedure('public.product_discovery_search_document_v2(text, text, text, text, jsonb)') IS NOT NULL THEN
    ALTER FUNCTION public.product_discovery_search_document_v2(text, text, text, text, jsonb) SET SCHEMA discovery;
  END IF;
END
$$;
