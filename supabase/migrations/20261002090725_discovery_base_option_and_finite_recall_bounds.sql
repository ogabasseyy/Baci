-- Shared purchasability for variantless base conditions, plus explicit
-- finite-double guards for recall matching and ranking.
CREATE OR REPLACE FUNCTION discovery.base_product_option_is_purchasable(
  p_product_id uuid,
  p_merchant_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.products AS p
    JOIN public.merchants AS m ON m.id = p.merchant_id
    LEFT JOIN LATERAL (
      SELECT anchor.effective_policy, anchor.available_units
      FROM public.get_mcp_search_serialized_anchor_policies(ARRAY[p.id], p_merchant_id) AS anchor
      LIMIT 1
    ) AS serialized ON TRUE
    WHERE p.id = p_product_id
      AND p.merchant_id = p_merchant_id
      AND p.has_variants IS NOT TRUE
      AND p.status = 'active'
      AND (COALESCE(m.is_published, FALSE) IS TRUE OR COALESCE(m.is_platform_admin, FALSE) IS TRUE)
      AND (
        COALESCE(serialized.effective_policy, 'off') = 'serialized_then_unlimited'
        OR (serialized.effective_policy = 'serialized_strict'
          AND COALESCE(serialized.available_units, 0) > 0)
        OR (serialized.effective_policy IS NULL
          AND (p.manage_stock IS NOT TRUE OR COALESCE(p.stock_quantity, 0) > 0))
      )
  );
$$;
ALTER FUNCTION discovery.base_product_option_is_purchasable(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION discovery.base_product_option_is_purchasable(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION discovery.base_product_option_is_purchasable(uuid, uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION discovery.base_product_option_is_purchasable(uuid, uuid) IS
  'Base option purchasability using the canonical serialized anchor projection and parent stock fallback.';

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
    IF actual_float = 'Infinity'::float8 THEN RETURN true; END IF;
    expected_float := (filter_value)::text::float8;
    IF filter_operator = 'eq' AND actual_float IS DISTINCT FROM expected_float THEN RETURN true; END IF;
    IF filter_operator = 'gte' AND actual_float < expected_float THEN RETURN true; END IF;
    IF filter_operator = 'lte' AND actual_float > expected_float THEN RETURN true; END IF;
    RETURN false;
  ELSE
    IF pg_catalog.jsonb_typeof(last_value) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    -- Collapse internal whitespace like the matcher, which normalizes
    -- both sides: without this a multi-space value falsely mismatches.
    actual_text := pg_catalog.regexp_replace(pg_catalog.translate(pg_catalog.regexp_replace(
      pg_catalog.normalize(last_value #>> '{}', 'NFC'), '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),
      '[[:space:]   -     　﻿]+', ' ', 'g');
    expected_text := pg_catalog.regexp_replace(pg_catalog.translate(pg_catalog.regexp_replace(
      pg_catalog.normalize(filter_value #>> '{}', 'NFC'), '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),
      '[[:space:]   -     　﻿]+', ' ', 'g');
    IF actual_text IS DISTINCT FROM expected_text THEN RETURN true; ELSE RETURN false; END IF;
  END IF;
END;
$$;

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
    IF actual_float = 'Infinity'::float8 THEN RETURN false; END IF;
    IF filter_operator = 'eq' AND actual_float = (filter_value)::text::float8 THEN RETURN true; END IF;
    IF filter_operator = 'gte' AND actual_float >= (filter_value)::text::float8 THEN RETURN true; END IF;
    IF filter_operator = 'lte' AND actual_float <= (filter_value)::text::float8 THEN RETURN true; END IF;
    RETURN false;
  ELSE
    IF pg_catalog.jsonb_typeof(last_value) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    -- Collapse internal whitespace like the matcher, which normalizes
    -- both sides: without this a multi-space value falsely mismatches.
    actual_text := pg_catalog.regexp_replace(pg_catalog.translate(pg_catalog.regexp_replace(
      pg_catalog.normalize(last_value #>> '{}', 'NFC'), '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),
      '[[:space:]   -     　﻿]+', ' ', 'g');
    expected_text := pg_catalog.regexp_replace(pg_catalog.translate(pg_catalog.regexp_replace(
      pg_catalog.normalize(filter_value #>> '{}', 'NFC'), '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),
      '[[:space:]   -     　﻿]+', ' ', 'g');
    -- A blank constraint value never matches in the loader, even against a
    -- blank variant value.
    IF expected_text = '' THEN RETURN false; END IF;
    IF actual_text = expected_text THEN RETURN true; ELSE RETURN false; END IF;
  END IF;
END;
$$;

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
    IF actual_float = 'Infinity'::float8 THEN RETURN false; END IF;
    IF filter_operator = 'eq' THEN RETURN actual_float = (filter_value)::text::float8; END IF;
    IF filter_operator = 'gte' THEN RETURN actual_float >= (filter_value)::text::float8; END IF;
    RETURN actual_float <= (filter_value)::text::float8;
  ELSE
    IF pg_catalog.jsonb_typeof(last_value) IS DISTINCT FROM 'string' THEN RETURN true; END IF;
    actual_text := pg_catalog.regexp_replace(pg_catalog.translate(pg_catalog.regexp_replace(
      pg_catalog.normalize(last_value #>> '{}', 'NFC'), '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),
      '[[:space:]   -     　﻿]+', ' ', 'g');
    expected_text := pg_catalog.regexp_replace(pg_catalog.translate(pg_catalog.regexp_replace(
      pg_catalog.normalize(filter_value #>> '{}', 'NFC'), '^[[:space:]   -     　﻿]+|[[:space:]   -     　﻿]+$', '', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),
      '[[:space:]   -     　﻿]+', ' ', 'g');
    -- A blank constraint value never matches in the loader, even against a
    -- blank variant value.
    IF expected_text = '' THEN RETURN false; END IF;
    RETURN actual_text = expected_text;
  END IF;
END;
$$;
