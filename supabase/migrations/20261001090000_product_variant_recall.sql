-- Merchant-scoped variant-attribute matchers for MCP discovery recall. The
-- serving search document never indexes product_variants, and the table's
-- SELECT policy is staff-only, so these internal helpers back the SECURITY
-- DEFINER recall RPC (20261001093000) with the same loader-mirroring
-- semantics: last-wins duplicate aliases, fail-open superset matching, and
-- a strict loader-acceptance dual for representative selection.
CREATE SCHEMA IF NOT EXISTS discovery;

CREATE OR REPLACE FUNCTION discovery.recall_variant_parse_numeric(filter_key text, raw jsonb)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  match text[];
  num numeric;
  unit text;
  label text;
BEGIN
  IF pg_catalog.jsonb_typeof(raw) = 'number' THEN
    num := (raw)::text::numeric;
    IF num >= 0 THEN RETURN num; END IF;
    RETURN NULL;
  END IF;
  IF pg_catalog.jsonb_typeof(raw) IS DISTINCT FROM 'string' THEN RETURN NULL; END IF;
  -- Mirror the loader's unit grammar exactly: optional ram prefix, decimal,
  -- optional unit, optional stock label. NULL means unparseable (keep row).
  -- Whitespace is the explicit JavaScript set: PostgreSQL \s omits U+FEFF.
  match := pg_catalog.regexp_match(raw #>> '{}',
    '^[[:space:]   -     　﻿]*(ram[[:space:]   -     　﻿]*)?(\d+(?:\.\d+)?)[[:space:]   -     　﻿]*(gb|tb|mb|w|hz|inches|inch|in)?([[:space:]   -     　﻿]+(ram|memory|ssd|hdd|nvme|emmc))?[[:space:]   -     　﻿]*$', 'i');
  IF match IS NULL THEN RETURN NULL; END IF;
  IF (raw #>> '{}') ~* '^[[:space:]   -     　﻿]*ram([^a-z0-9_]|$)' AND filter_key IS DISTINCT FROM 'ram_gb' THEN
    RETURN NULL;
  END IF;
  label := pg_catalog.lower(match[5]);
  IF label IS NOT NULL AND NOT ((filter_key = 'ram_gb' AND label IN ('ram', 'memory'))
    OR (filter_key = 'storage_gb' AND label IN ('ssd', 'hdd', 'nvme', 'emmc'))) THEN
    RETURN NULL;
  END IF;
  num := match[2]::numeric;
  unit := pg_catalog.lower(match[3]);
  IF filter_key IN ('storage_gb', 'ram_gb') THEN
    IF unit IS NULL OR unit = 'gb' THEN RETURN num;
    ELSIF unit = 'tb' THEN RETURN num * 1024;
    ELSIF unit = 'mb' THEN RETURN num / 1024;
    END IF;
    RETURN NULL;
  END IF;
  IF unit IS NULL THEN RETURN num; END IF;
  IF filter_key = 'power_w' AND unit = 'w' THEN RETURN num; END IF;
  IF filter_key = 'refresh_hz' AND unit = 'hz' THEN RETURN num; END IF;
  IF filter_key = 'screen_inches' AND unit IN ('in', 'inch', 'inches') THEN RETURN num; END IF;
  RETURN NULL;
END;
$$;

-- Binary64 lens over the exact-numeric parse: PostgREST decodes JSON
-- numbers to JavaScript doubles, so 256.00000000000001 reads as 256
-- downstream while exact numeric would verifiably fail it here. Unit math
-- stays exact (powers of two divide exactly), and the final rounding
-- matches the loader's doubles; past float8 range the loader observes
-- Infinity, so overflow maps there instead of erroring (actuals are
-- nonneg by construction, keeping the sign branch out).
CREATE OR REPLACE FUNCTION discovery.recall_variant_parse_float8(filter_key text, raw jsonb)
RETURNS float8
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  num numeric;
BEGIN
  num := discovery.recall_variant_parse_numeric(filter_key, raw);
  IF num IS NULL THEN RETURN NULL; END IF;
  BEGIN
    RETURN num::float8;
  EXCEPTION WHEN numeric_value_out_of_range THEN
    RETURN 'Infinity'::float8;
  END;
END;
$$;

-- Canonical-key test shared by the superset and exact matchers: mirror
-- normalizeAxisKey + the commerce alias map + the discovery allowlist so
-- only keys the loader would normalize to filter_key count.
CREATE OR REPLACE FUNCTION discovery.recall_variant_key_matches(filter_key text, entry_key text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  axis text;
BEGIN
  axis := pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(entry_key, '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g'),
    '([a-z0-9])([A-Z])', '\1_\2', 'g'), '[[:space:].-]+', '_', 'g'));
  axis := CASE axis WHEN 'colour' THEN 'color' WHEN 'gpu' THEN 'graphics'
    WHEN 'ram_options' THEN 'ram' WHEN 'storage_capacity' THEN 'storage' ELSE axis END;
  RETURN (filter_key = 'storage_gb' AND axis IN ('storage', 'storage_gb', 'capacity'))
    OR (filter_key = 'ram_gb' AND axis IN ('ram', 'memory', 'ram_gb'))
    OR (filter_key = 'power_w' AND axis IN ('power', 'wattage', 'power_w'))
    OR (filter_key IN ('screen_inches', 'refresh_hz', 'color', 'connector', 'processor', 'connectivity')
      AND axis = filter_key);
END;
$$;

CREATE OR REPLACE FUNCTION discovery.recall_variant_filter_verifiably_fails(attributes jsonb, filter jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  filter_key text;
  filter_operator text;
  filter_value jsonb;
  numeric_key boolean;
  entry_key text;
  entry_value jsonb;
  last_value jsonb;
  found boolean := false;
  actual_float float8;
  expected_float float8;
  actual_text text;
  expected_text text;
BEGIN
  IF pg_catalog.jsonb_typeof(filter) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  filter_key := filter ->> 'key';
  filter_operator := filter ->> 'operator';
  filter_value := filter -> 'value';
  numeric_key := filter_key IN ('storage_gb', 'ram_gb', 'power_w', 'screen_inches', 'refresh_hz');
  -- Malformed filters keep the row: type mismatches and text ranges cannot
  -- occur in schema-valid intents, and a recall boundary must fail open.
  IF filter_key NOT IN ('storage_gb', 'ram_gb', 'power_w', 'screen_inches', 'refresh_hz',
      'color', 'connector', 'processor', 'connectivity')
    OR filter_operator NOT IN ('eq', 'gte', 'lte')
    OR (numeric_key AND pg_catalog.jsonb_typeof(filter_value) IS DISTINCT FROM 'number')
    OR (NOT numeric_key AND (filter_operator IS DISTINCT FROM 'eq'
      OR pg_catalog.jsonb_typeof(filter_value) IS DISTINCT FROM 'string'))
  THEN RETURN false; END IF;
  IF pg_catalog.jsonb_typeof(attributes) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  FOR entry_key, entry_value IN SELECT * FROM pg_catalog.jsonb_each(attributes) LOOP
    IF discovery.recall_variant_key_matches(filter_key, entry_key) THEN
      last_value := entry_value;
      found := true;
    END IF;
  END LOOP;
  -- Last alias wins, mirroring the loader's overwrite pass over the same
  -- document order: deciding on an earlier alias would discard rows the
  -- loader recalls (storage 128GB followed by capacity 256GB satisfies a
  -- 256GB intent).
  IF NOT found THEN RETURN false; END IF;
  IF numeric_key THEN
    actual_float := discovery.recall_variant_parse_float8(filter_key, last_value);
    IF actual_float IS NULL THEN RETURN false; END IF;
    expected_float := (filter_value)::text::float8;
    IF filter_operator = 'eq' AND actual_float IS DISTINCT FROM expected_float THEN RETURN true; END IF;
    IF filter_operator = 'gte' AND actual_float < expected_float THEN RETURN true; END IF;
    IF filter_operator = 'lte' AND actual_float > expected_float THEN RETURN true; END IF;
    RETURN false;
  ELSE
    IF pg_catalog.jsonb_typeof(last_value) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    -- Collapse internal whitespace like the matcher, which normalizes
    -- both sides: without this a multi-space value falsely mismatches.
    actual_text := pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.regexp_replace(
      pg_catalog.normalize(last_value #>> '{}', 'NFC'), '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g')),
      '[[:space:]   -     　﻿]+', ' ', 'g');
    expected_text := pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.regexp_replace(
      pg_catalog.normalize(filter_value #>> '{}', 'NFC'), '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g')),
      '[[:space:]   -     　﻿]+', ' ', 'g');
    IF actual_text IS DISTINCT FROM expected_text THEN RETURN true; ELSE RETURN false; END IF;
  END IF;
END;
$$;

-- Strict dual of the superset matcher: true only when a canonical key is
-- present, its value parses, and the comparison holds. Drives exact-first
-- ordering so sparse keys cannot flood the cap ahead of real matches.
CREATE OR REPLACE FUNCTION discovery.recall_variant_filter_exactly_matches(attributes jsonb, filter jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  filter_key text;
  filter_operator text;
  filter_value jsonb;
  numeric_key boolean;
  entry_key text;
  entry_value jsonb;
  last_value jsonb;
  found boolean := false;
  actual_float float8;
  actual_text text;
  expected_text text;
BEGIN
  IF pg_catalog.jsonb_typeof(filter) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  filter_key := filter ->> 'key';
  filter_operator := filter ->> 'operator';
  filter_value := filter -> 'value';
  numeric_key := filter_key IN ('storage_gb', 'ram_gb', 'power_w', 'screen_inches', 'refresh_hz');
  IF filter_key NOT IN ('storage_gb', 'ram_gb', 'power_w', 'screen_inches', 'refresh_hz',
      'color', 'connector', 'processor', 'connectivity')
    OR filter_operator NOT IN ('eq', 'gte', 'lte')
    OR (numeric_key AND pg_catalog.jsonb_typeof(filter_value) IS DISTINCT FROM 'number')
    OR (NOT numeric_key AND (filter_operator IS DISTINCT FROM 'eq'
      OR pg_catalog.jsonb_typeof(filter_value) IS DISTINCT FROM 'string'))
  THEN RETURN false; END IF;
  IF pg_catalog.jsonb_typeof(attributes) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  FOR entry_key, entry_value IN SELECT * FROM pg_catalog.jsonb_each(attributes) LOOP
    IF discovery.recall_variant_key_matches(filter_key, entry_key) THEN
      last_value := entry_value;
      found := true;
    END IF;
  END LOOP;
  -- Last alias wins, like the superset matcher and the loader's overwrite
  -- pass: the exact flag must describe the value the loader would decide on.
  IF NOT found THEN RETURN false; END IF;
  IF numeric_key THEN
    actual_float := discovery.recall_variant_parse_float8(filter_key, last_value);
    IF actual_float IS NULL THEN RETURN false; END IF;
    IF filter_operator = 'eq' AND actual_float = (filter_value)::text::float8 THEN RETURN true; END IF;
    IF filter_operator = 'gte' AND actual_float >= (filter_value)::text::float8 THEN RETURN true; END IF;
    IF filter_operator = 'lte' AND actual_float <= (filter_value)::text::float8 THEN RETURN true; END IF;
    RETURN false;
  ELSE
    IF pg_catalog.jsonb_typeof(last_value) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    -- Collapse internal whitespace like the matcher, which normalizes
    -- both sides: without this a multi-space value falsely mismatches.
    actual_text := pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.regexp_replace(
      pg_catalog.normalize(last_value #>> '{}', 'NFC'), '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g')),
      '[[:space:]   -     　﻿]+', ' ', 'g');
    expected_text := pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.regexp_replace(
      pg_catalog.normalize(filter_value #>> '{}', 'NFC'), '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g')),
      '[[:space:]   -     　﻿]+', ' ', 'g');
    -- A blank constraint value never matches in the loader, even against a
    -- blank variant value.
    IF expected_text = '' THEN RETURN false; END IF;
    IF actual_text = expected_text THEN RETURN true; ELSE RETURN false; END IF;
  END IF;
END;
$$;

-- Loader-acceptance mirror: true exactly when the loader would recall this
-- row for the filter (last alias wins; missing keys and equality-with-an
-- unparseable-value accept; ranges need a parsed comparison that holds).
-- Malformed filters fail open. Drives one-row-per-product selection so the
-- representative preserves the loader's product decision exactly.
CREATE OR REPLACE FUNCTION discovery.recall_variant_filter_loader_accepts(attributes jsonb, filter jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  filter_key text;
  filter_operator text;
  filter_value jsonb;
  numeric_key boolean;
  entry_key text;
  entry_value jsonb;
  last_value jsonb;
  found boolean := false;
  actual_float float8;
  actual_text text;
  expected_text text;
BEGIN
  IF pg_catalog.jsonb_typeof(filter) IS DISTINCT FROM 'object' THEN RETURN true; END IF;
  filter_key := filter ->> 'key';
  filter_operator := filter ->> 'operator';
  filter_value := filter -> 'value';
  numeric_key := filter_key IN ('storage_gb', 'ram_gb', 'power_w', 'screen_inches', 'refresh_hz');
  IF filter_key NOT IN ('storage_gb', 'ram_gb', 'power_w', 'screen_inches', 'refresh_hz',
      'color', 'connector', 'processor', 'connectivity')
    OR filter_operator NOT IN ('eq', 'gte', 'lte')
    OR (numeric_key AND pg_catalog.jsonb_typeof(filter_value) IS DISTINCT FROM 'number')
    OR (NOT numeric_key AND (filter_operator IS DISTINCT FROM 'eq'
      OR pg_catalog.jsonb_typeof(filter_value) IS DISTINCT FROM 'string'))
  THEN RETURN true; END IF;
  IF pg_catalog.jsonb_typeof(attributes) IS DISTINCT FROM 'object' THEN RETURN true; END IF;
  FOR entry_key, entry_value IN SELECT * FROM pg_catalog.jsonb_each(attributes) LOOP
    IF discovery.recall_variant_key_matches(filter_key, entry_key) THEN
      last_value := entry_value;
      found := true;
    END IF;
  END LOOP;
  IF NOT found THEN RETURN true; END IF;
  IF numeric_key THEN
    actual_float := discovery.recall_variant_parse_float8(filter_key, last_value);
    IF actual_float IS NULL THEN RETURN filter_operator = 'eq'; END IF;
    IF filter_operator = 'eq' THEN RETURN actual_float = (filter_value)::text::float8; END IF;
    IF filter_operator = 'gte' THEN RETURN actual_float >= (filter_value)::text::float8; END IF;
    RETURN actual_float <= (filter_value)::text::float8;
  ELSE
    IF pg_catalog.jsonb_typeof(last_value) IS DISTINCT FROM 'string' THEN RETURN true; END IF;
    actual_text := pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.regexp_replace(
      pg_catalog.normalize(last_value #>> '{}', 'NFC'), '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g')),
      '[[:space:]   -     　﻿]+', ' ', 'g');
    expected_text := pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.regexp_replace(
      pg_catalog.normalize(filter_value #>> '{}', 'NFC'), '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g')),
      '[[:space:]   -     　﻿]+', ' ', 'g');
    -- A blank constraint value never matches in the loader, even against a
    -- blank variant value.
    IF expected_text = '' THEN RETURN false; END IF;
    RETURN actual_text = expected_text;
  END IF;
END;
$$;