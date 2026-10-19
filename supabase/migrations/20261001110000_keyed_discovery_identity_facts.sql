-- disable-transaction
-- Identity constraints (type, brand, model, compatibility) matched the
-- combined marketing vector, so hundreds of accessories mentioning 'phone'
-- could fill the capped fact window before the actual phone loads. Index
-- key-specific identity lexemes derived from the same authoritative fields
-- the matcher verifies, so the capped window fills with identity matches.
-- Identity normalization mirrors TS identityKey exactly: NFKC first, then
-- trim with the JavaScript trim set (compatibility decomposition can create
-- trimmable edges), lowercase, and collapse whitespace runs to _.
CREATE OR REPLACE FUNCTION discovery.discovery_identity_normalize(raw text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT pg_catalog.regexp_replace(
    pg_catalog.translate(pg_catalog.regexp_replace(
      pg_catalog.normalize(raw, 'NFKC'),
      '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),
    '[[:space:]   -     　﻿-]+', '_', 'g');
$$;

-- Exact mirror of the final matcher normalization (NFC, JavaScript trim,
-- lowercase, interior whitespace to one space): brand/model/compat lexemes
-- digest this so retrieval agrees with post-hydration verdicts bit for bit.
CREATE OR REPLACE FUNCTION discovery.discovery_identity_matcher_normalize(raw text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT pg_catalog.regexp_replace(
    pg_catalog.translate(pg_catalog.regexp_replace(
      pg_catalog.normalize(raw, 'NFC'),
      '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),
    '[[:space:]   -     　﻿]+', ' ', 'g');
$$;

-- Identity lexeme: brand/model/compat always emit an exact digest of the
-- matcher normalization (tag + unit separator + normalized identity),
-- mirroring the v4 text-attribute convention, because coarse keys folded
-- separators the final matcher distinguishes. The tag keeps digests
-- distinct from each other and from v4's. Canonical type keys stay coarse
-- with the Unicode-safe digest fallback for fully stripped values.
CREATE OR REPLACE FUNCTION discovery.discovery_identity_lexeme(tag text, raw text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT CASE
    WHEN tag IN ('brand', 'model', 'compat') THEN
      CASE WHEN matcher IS NULL OR matcher = '' THEN NULL
      ELSE 'fact' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        tag || pg_catalog.chr(31) || matcher, 'UTF8'), 'sha256'), 'hex') END
    WHEN normalized IS NULL OR normalized = '' THEN NULL
    WHEN cleaned = '' OR pg_catalog.char_length(cleaned) > 64
      THEN 'fact' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        tag || pg_catalog.chr(31) || normalized, 'UTF8'), 'sha256'), 'hex')
    ELSE tag || cleaned
  END
  FROM (SELECT discovery.discovery_identity_normalize(raw) AS normalized,
               discovery.discovery_identity_matcher_normalize(raw) AS matcher) AS input,
    LATERAL (SELECT pg_catalog.regexp_replace(normalized, '[^a-z0-9_]', '', 'g') AS cleaned) AS stripped;
$$;

-- Shared product-type canonicalizer, defined here (not in
-- 20261001160000) because the v5 index build below executes it: the
-- 20261001160000 re-creation only re-pins the identical definition.
-- Exact mirror of canonicalizeDiscoveryProductType over the matcher's
-- normalizeText output: NFC folds into NFKC and the pre-trims are
-- subsumed, but the trim MUST follow NFKC (compatibility decomposition
-- can create trimmable edges, e.g. U+3000), or whitespace-only values
-- canonicalize to a phantom underscore the runtime never produces. The
-- class is the JS trim set, copied from product_discovery_text_length.
CREATE OR REPLACE FUNCTION discovery.canonical_identity_product_type(product_type text, category text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  normalized text;
  categorized text;
BEGIN
  normalized := pg_catalog.translate(pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(
      pg_catalog.normalize(product_type, 'NFKC'),
      '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g'),
    '[[:space:]   -     　﻿-]+', '_', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
  IF nullif(normalized, '') IS NOT NULL THEN
    RETURN CASE normalized
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
      ELSE normalized END;
  END IF;
  -- Storefront category map, mirroring productTypeOf exactly (NFC
  -- lowercase with interior spaces collapsed; no underscore mapping here).
  categorized := pg_catalog.regexp_replace(
    pg_catalog.translate(pg_catalog.regexp_replace(
      pg_catalog.normalize(category, 'NFC'),
      '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),
    '[[:space:]   -     　﻿]+', ' ', 'g');
  IF categorized = 'smartphones' THEN RETURN 'phone'; END IF;
  IF categorized = 'laptops' THEN RETURN 'laptop'; END IF;
  IF categorized = 'tablets' THEN RETURN 'tablet'; END IF;
  RETURN NULL;
END;
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
        -- Canonical types route through the shared canonicalizer so the
        -- indexed lexeme matches the validator and the query builder bit
        -- for bit: the older inline trim-then-NFKC path emitted type_phone
        -- for inputs like ¨phone while the builder queried typephone.
        -- Overlong values still digest through the shared lexeme exactly
        -- like the builder's identityKey.
        SELECT discovery.discovery_identity_lexeme('type',
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

-- Build the replacement under a temporary name before switching the serving
-- RPC: on a retry after the switch, a serving v5 index already exists, and
-- dropping it first would force every discovery query through a full product
-- scan for the duration of the concurrent rebuild.
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
  WHERE c.oid = pg_catalog.to_regclass('public.products_discovery_identity_search_idx_new');
  IF pg_catalog.to_regclass('public.products_discovery_identity_search_idx') IS NULL
    AND COALESCE(replacement_serving, false) THEN
    ALTER INDEX public.products_discovery_identity_search_idx_new RENAME TO products_discovery_identity_search_idx;
  END IF;
END;
$$;
DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_identity_search_idx_new;
CREATE INDEX CONCURRENTLY products_discovery_identity_search_idx_new ON public.products USING gin
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
      pg_catalog.translate(p.brand, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), pg_catalog.translate(brand_filter, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')) > 0)
    AND (category_filter IS NULL OR pg_catalog.strpos(
      pg_catalog.translate(p.category, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), pg_catalog.translate(category_filter, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')) > 0)
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
-- Retire the pre-switch identity build (a no-op on first run) and promote
-- the replacement to the canonical name.
DROP INDEX CONCURRENTLY IF EXISTS public.products_discovery_identity_search_idx;
ALTER INDEX IF EXISTS public.products_discovery_identity_search_idx_new RENAME TO products_discovery_identity_search_idx;
