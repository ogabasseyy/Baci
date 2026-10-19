-- Public search facts, separate from private product metadata and merchandising categories.
-- Existing product publication and merchant-write RLS remain authoritative.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS discovery_metadata jsonb;
CREATE SCHEMA IF NOT EXISTS discovery;

-- Shape mirror of productDiscoveryMetadataSchema: authenticated clients can
-- write discovery_metadata directly through PostgREST, bypassing the
-- validated PUT route. Unknown fields or mistyped attributes would fail the
-- reader's strict safeParse and silently drop the product from structured
-- matches, so the same shape holds at this boundary. A CHECK cannot contain
-- the subqueries this validation needs, hence the helpers.
-- UTF-16 length of the JS-trimmed value: zod measures .max(100) in UTF-16
-- units after String trim, while char_length counts code points, so astral
-- text and exotic whitespace need identical treatment here. Each astral
-- code point is one UTF-8 four-byte sequence (lead byte F0-F4, never a
-- continuation byte), so units = characters + lead-byte count. The trim
-- class is the specified trim set: ASCII whitespace plus U+00A0, U+1680,
-- U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF.
CREATE OR REPLACE FUNCTION discovery.product_discovery_text_length(raw text)
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT pg_catalog.char_length(trimmed) + (
    SELECT count(*)::integer FROM (
      SELECT (pg_catalog.regexp_matches(pg_catalog.encode(
        pg_catalog.convert_to(trimmed, 'UTF8'), 'hex'), '..', 'g'))[1] AS byte
    ) AS bytes WHERE byte >= 'f0' AND byte <= 'f4')
  FROM (SELECT pg_catalog.regexp_replace(raw,
    '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g') AS trimmed) AS t;
$$;
-- Binary64 round-trip: the SQL builder expands the stored decimal while the
-- JavaScript reader decodes the nearest double, so a value like
-- 256.00000000000001 indexes unit lexemes no 256 intent can retrieve. A
-- storable decimal must equal PostgreSQL's shortest float8 rendering parsed
-- back, which is what JavaScript prints for the same double (PG 12+
-- float output). Naturally written decimals (0.1, 15.6) pass; only
-- beyond-double precision and integers past 2^53 fail. Callers range-check
-- first: float8 overflows past Number.MAX_VALUE.
-- Shortest float rendering requires extra_float_digits = 1: sessions
-- running at 0 (notably the hosted replay image) print fewer digits, so
-- Number.MAX_VALUE would fail its own round-trip. The pin keeps the CHECK
-- verdict identical in every session.
CREATE OR REPLACE FUNCTION discovery.product_discovery_numeric_round_trips(raw jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = '' SET extra_float_digits = 1
AS $$
  SELECT (raw)::text::numeric = (((raw)::text::float8)::text)::numeric;
$$;
CREATE OR REPLACE FUNCTION discovery.product_discovery_metadata_valid(facts jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
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
      IF discovery.product_discovery_text_length(facts ->> top_key) NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
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
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass
      AND conname = 'products_discovery_metadata_object'
  ) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_discovery_metadata_object
      CHECK (discovery.product_discovery_metadata_valid(discovery_metadata))
      NOT VALID;
  END IF;
END;
$$;
-- Left NOT VALID on purpose: validation scans the populated table, so it
-- runs in 20261001120000_validate_discovery_metadata.sql after this
-- transaction commits the ALTER TABLE lock.
COMMENT ON COLUMN public.products.discovery_metadata IS
  'Merchant-verified public discovery facts: product_type, model, compatible_with and canonical attributes. Missing facts are unknown; never infer availability or price from this document.';
