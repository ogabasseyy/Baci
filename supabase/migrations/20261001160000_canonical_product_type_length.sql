-- Canonicalized product-type length at the SQL boundary. The metadata
-- CHECK measured the raw stored value while the reader schema measures the
-- NFKC-canonicalized output, so a direct PostgREST write of 100
-- compatibility ligatures passed the boundary and then failed the reader,
-- dropping the product's indexed facts. Length now applies to the same
-- canonicalized value the runtime uses. The shared canonicalizer is also
-- tightened to the exact runtime pipeline (trim after NFKC with the JS
-- trim set), replacing the index-normalizer approximation it started with.
DROP FUNCTION IF EXISTS discovery.canonical_identity_product_type(text, text);
CREATE FUNCTION discovery.canonical_identity_product_type(product_type text, category text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  normalized text;
  categorized text;
BEGIN
  -- Exact mirror of canonicalizeDiscoveryProductType over the matcher's
  -- normalizeText output: NFC folds into NFKC and the pre-trims are
  -- subsumed, but the trim MUST follow NFKC (compatibility decomposition
  -- can create trimmable edges, e.g. U+3000), or whitespace-only values
  -- canonicalize to a phantom underscore the runtime never produces. The
  -- class is the JS trim set, copied from product_discovery_text_length.
  normalized := pg_catalog.lower(pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(
      pg_catalog.normalize(product_type, 'NFKC'),
      '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g'),
    '[[:space:]   -     　﻿-]+', '_', 'g'));
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
    pg_catalog.lower(pg_catalog.regexp_replace(
      pg_catalog.normalize(category, 'NFC'),
      '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g')),
    '[[:space:]   -     　﻿]+', ' ', 'g');
  IF categorized = 'smartphones' THEN RETURN 'phone'; END IF;
  IF categorized = 'laptops' THEN RETURN 'laptop'; END IF;
  IF categorized = 'tablets' THEN RETURN 'tablet'; END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION discovery.product_discovery_metadata_valid(facts jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  canonical_type text;
  top_key text;
  entry_key text;
  entry_value jsonb;
  attribute_count integer := 0;
BEGIN
  IF facts IS NULL THEN RETURN true; END IF;
  IF pg_catalog.jsonb_typeof(facts) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF pg_catalog.octet_length(facts::text) > 16384 THEN RETURN false; END IF;
  FOR top_key IN SELECT * FROM pg_catalog.jsonb_object_keys(facts) LOOP
    IF top_key NOT IN ('product_type', 'model', 'compatible_with', 'attributes') THEN RETURN false; END IF;
  END LOOP;
  FOR top_key IN SELECT pg_catalog.unnest(ARRAY['product_type', 'model']) LOOP
    IF facts -> top_key IS NOT NULL THEN
      IF pg_catalog.jsonb_typeof(facts -> top_key) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
      -- Length applies to the canonicalized output, mirroring the route
      -- schema's .pipe(text): NFKC can triple compatibility characters
      -- (100 ligatures become 300), and the reader rejects the whole
      -- document when the canonical form exceeds 100 units. Direct writes
      -- must meet the same bound or the stored facts read as absent.
      IF top_key = 'product_type' THEN
        canonical_type := discovery.canonical_identity_product_type(facts ->> top_key, NULL);
        IF canonical_type IS NULL
          OR discovery.product_discovery_text_length(canonical_type) NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
      ELSIF discovery.product_discovery_text_length(facts ->> top_key) NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
    END IF;
  END LOOP;
  IF facts -> 'compatible_with' IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(facts -> 'compatible_with') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    IF pg_catalog.jsonb_array_length(facts -> 'compatible_with') > 50 THEN RETURN false; END IF;
    FOR entry_value IN SELECT * FROM pg_catalog.jsonb_array_elements(facts -> 'compatible_with') LOOP
      IF pg_catalog.jsonb_typeof(entry_value) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
      IF discovery.product_discovery_text_length(entry_value #>> '{}') NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
    END LOOP;
  END IF;
  IF facts -> 'attributes' IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(facts -> 'attributes') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    FOR entry_key, entry_value IN SELECT * FROM pg_catalog.jsonb_each(facts -> 'attributes') LOOP
      attribute_count := attribute_count + 1;
      IF attribute_count > 50 THEN RETURN false; END IF;
      IF entry_key !~ '^[a-z][a-z0-9_]{0,49}$' THEN RETURN false; END IF;
      -- Finite range, not just nonnegativity: jsonb accepts 1e309 but the
      -- JavaScript reader decodes it as Infinity, failing the schema's
      -- finite() check for the whole document. The bound is Number.MAX_VALUE;
      -- values in the sub-ULP overflow band decode finite but are rejected
      -- all the same, erring toward never storing unverifiable numbers.
      IF entry_key IN ('storage_gb', 'ram_gb', 'power_w', 'screen_inches', 'refresh_hz') THEN
        -- Sequential guards: the range cast must precede the float8
        -- round-trip (which overflows past MAX_VALUE), and OR clause order
        -- is undefined, so each check is its own statement.
        IF pg_catalog.jsonb_typeof(entry_value) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
        IF (entry_value)::text::numeric < 0
          OR (entry_value)::text::numeric > 1.7976931348623157e308 THEN RETURN false; END IF;
        IF NOT discovery.product_discovery_numeric_round_trips(entry_value) THEN RETURN false; END IF;
      ELSIF entry_key IN ('color', 'connector', 'processor', 'connectivity') THEN
        IF pg_catalog.jsonb_typeof(entry_value) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
        IF discovery.product_discovery_text_length(entry_value #>> '{}') NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
      ELSIF pg_catalog.jsonb_typeof(entry_value) = 'number' THEN
        IF (entry_value)::text::numeric < 0
          OR (entry_value)::text::numeric > 1.7976931348623157e308 THEN RETURN false; END IF;
        IF NOT discovery.product_discovery_numeric_round_trips(entry_value) THEN RETURN false; END IF;
      ELSIF pg_catalog.jsonb_typeof(entry_value) = 'string' THEN
        IF discovery.product_discovery_text_length(entry_value #>> '{}') NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
      ELSE
        RETURN false;
      END IF;
    END LOOP;
  END IF;
  RETURN true;
END;
$$;
