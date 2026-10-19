-- NFKC-aware product_type length in the discovery metadata CHECK.
-- The reader schema canonicalizes product_type with NFKC before its
-- 100-unit limit, and NFKC can expand compatibility characters (100
-- ﬃ ligatures become 300 chars), so measuring the raw value admits
-- direct writes the reader rejects as unverified. Measure the NFKC
-- form instead; model and the other text fields take no
-- canonicalization, so their raw checks stand. Same signature:
-- CREATE OR REPLACE, no drop.
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
  IF facts -> 'product_type' IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(facts -> 'product_type') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    IF discovery.product_discovery_text_length(
      pg_catalog.normalize(facts ->> 'product_type', 'NFKC')) NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
  END IF;
  IF facts -> 'model' IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(facts -> 'model') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    IF discovery.product_discovery_text_length(facts ->> 'model') NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
  END IF;
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
