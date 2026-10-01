-- Public search facts, separate from private product metadata and merchandising categories.
-- Existing product publication and merchant-write RLS remain authoritative.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS discovery_metadata jsonb;
CREATE SCHEMA IF NOT EXISTS discovery;

-- Shape mirror of productDiscoveryMetadataSchema: authenticated clients can
-- write discovery_metadata directly through PostgREST, bypassing the
-- validated PUT route. Unknown fields or mistyped attributes would fail the
-- reader's strict safeParse and silently drop the product from structured
-- matches, so the same shape holds at this boundary. A CHECK cannot contain
-- the subqueries this validation needs, hence the helper. Residual corners
-- stay with the route: JS trim/UTF-16 length nuances for exotic whitespace
-- and astral text, which only shift boundary rejections, never the shape.
CREATE OR REPLACE FUNCTION discovery.product_discovery_metadata_valid(facts jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  top_key text;
  entry_key text;
  entry_value jsonb;
  trimmed text;
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
      trimmed := pg_catalog.regexp_replace(facts ->> top_key, '^[[:space:]]+|[[:space:]]+$', '', 'g');
      IF pg_catalog.char_length(trimmed) NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
    END IF;
  END LOOP;
  IF facts -> 'compatible_with' IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(facts -> 'compatible_with') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    IF pg_catalog.jsonb_array_length(facts -> 'compatible_with') > 50 THEN RETURN false; END IF;
    FOR entry_value IN SELECT * FROM pg_catalog.jsonb_array_elements(facts -> 'compatible_with') LOOP
      IF pg_catalog.jsonb_typeof(entry_value) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
      trimmed := pg_catalog.regexp_replace(entry_value #>> '{}', '^[[:space:]]+|[[:space:]]+$', '', 'g');
      IF pg_catalog.char_length(trimmed) NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
    END LOOP;
  END IF;
  IF facts -> 'attributes' IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(facts -> 'attributes') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    FOR entry_key, entry_value IN SELECT * FROM pg_catalog.jsonb_each(facts -> 'attributes') LOOP
      attribute_count := attribute_count + 1;
      IF attribute_count > 50 THEN RETURN false; END IF;
      IF entry_key !~ '^[a-z][a-z0-9_]{0,49}$' THEN RETURN false; END IF;
      IF entry_key IN ('storage_gb', 'ram_gb', 'power_w', 'screen_inches', 'refresh_hz') THEN
        IF pg_catalog.jsonb_typeof(entry_value) IS DISTINCT FROM 'number'
          OR (entry_value)::text::numeric < 0 THEN RETURN false; END IF;
      ELSIF entry_key IN ('color', 'connector', 'processor', 'connectivity') THEN
        IF pg_catalog.jsonb_typeof(entry_value) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
        trimmed := pg_catalog.regexp_replace(entry_value #>> '{}', '^[[:space:]]+|[[:space:]]+$', '', 'g');
        IF pg_catalog.char_length(trimmed) NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
      ELSIF pg_catalog.jsonb_typeof(entry_value) = 'number' THEN
        IF (entry_value)::text::numeric < 0 THEN RETURN false; END IF;
      ELSIF pg_catalog.jsonb_typeof(entry_value) = 'string' THEN
        trimmed := pg_catalog.regexp_replace(entry_value #>> '{}', '^[[:space:]]+|[[:space:]]+$', '', 'g');
        IF pg_catalog.char_length(trimmed) NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
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
