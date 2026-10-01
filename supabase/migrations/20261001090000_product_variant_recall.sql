-- Merchant-scoped variant attributes for MCP discovery recall. The serving
-- search document never indexes product_variants, and the table's SELECT
-- policy is staff-only, so recall reads through this SECURITY DEFINER
-- function with the same published-merchant eligibility as the feed RPC.
--
-- Constraints filter BEFORE the cap: ordering and limiting the whole variant
-- table first would strand a sole matching variant past the cap on large
-- catalogs, and product-level fact search cannot see variant attributes to
-- recover it. The WHERE clause mirrors the loader's matching as a recall
-- superset (missing keys, unparseable values, and malformed filters keep
-- the row), and exact matches order first so sparse keys cannot flood the
-- window ahead of them. The loader re-verifies precisely and the matcher
-- enforces every constraint post-hydration.
-- Duplicate aliases resolve last-wins like the loader's overwrite pass.
-- The cap measures products (one representative row each), and the filter
-- set itself is bounded because this RPC is anonymously executable.
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
  match := pg_catalog.regexp_match(raw #>> '{}',
    '^\s*(ram\s*)?(\d+(?:\.\d+)?)\s*(gb|tb|mb|w|hz|inches|inch|in)?(\s+(ram|memory|ssd|hdd|nvme|emmc))?\s*$', 'i');
  IF match IS NULL THEN RETURN NULL; END IF;
  IF (raw #>> '{}') ~* '^\s*ram([^a-z0-9_]|$)' AND filter_key IS DISTINCT FROM 'ram_gb' THEN
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
    pg_catalog.regexp_replace(entry_key, '^[[:space:]]+|[[:space:]]+$', '', 'g'),
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
  actual_numeric numeric;
  expected_numeric numeric;
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
    actual_numeric := discovery.recall_variant_parse_numeric(filter_key, last_value);
    IF actual_numeric IS NULL THEN RETURN false; END IF;
    expected_numeric := (filter_value)::text::numeric;
    IF filter_operator = 'eq' AND actual_numeric IS DISTINCT FROM expected_numeric THEN RETURN true; END IF;
    IF filter_operator = 'gte' AND actual_numeric < expected_numeric THEN RETURN true; END IF;
    IF filter_operator = 'lte' AND actual_numeric > expected_numeric THEN RETURN true; END IF;
    RETURN false;
  ELSE
    IF pg_catalog.jsonb_typeof(last_value) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    -- Collapse internal whitespace like the matcher, which normalizes
    -- both sides: without this a multi-space value falsely mismatches.
    actual_text := pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.regexp_replace(
      pg_catalog.normalize(last_value #>> '{}', 'NFC'), '^[[:space:]]+|[[:space:]]+$', '', 'g')),
      '[[:space:]]+', ' ', 'g');
    expected_text := pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.regexp_replace(
      pg_catalog.normalize(filter_value #>> '{}', 'NFC'), '^[[:space:]]+|[[:space:]]+$', '', 'g')),
      '[[:space:]]+', ' ', 'g');
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
  actual_numeric numeric;
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
    actual_numeric := discovery.recall_variant_parse_numeric(filter_key, last_value);
    IF actual_numeric IS NULL THEN RETURN false; END IF;
    IF filter_operator = 'eq' AND actual_numeric = (filter_value)::text::numeric THEN RETURN true; END IF;
    IF filter_operator = 'gte' AND actual_numeric >= (filter_value)::text::numeric THEN RETURN true; END IF;
    IF filter_operator = 'lte' AND actual_numeric <= (filter_value)::text::numeric THEN RETURN true; END IF;
    RETURN false;
  ELSE
    IF pg_catalog.jsonb_typeof(last_value) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    -- Collapse internal whitespace like the matcher, which normalizes
    -- both sides: without this a multi-space value falsely mismatches.
    actual_text := pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.regexp_replace(
      pg_catalog.normalize(last_value #>> '{}', 'NFC'), '^[[:space:]]+|[[:space:]]+$', '', 'g')),
      '[[:space:]]+', ' ', 'g');
    expected_text := pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.regexp_replace(
      pg_catalog.normalize(filter_value #>> '{}', 'NFC'), '^[[:space:]]+|[[:space:]]+$', '', 'g')),
      '[[:space:]]+', ' ', 'g');
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
  actual_numeric numeric;
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
    actual_numeric := discovery.recall_variant_parse_numeric(filter_key, last_value);
    IF actual_numeric IS NULL THEN RETURN filter_operator = 'eq'; END IF;
    IF filter_operator = 'eq' THEN RETURN actual_numeric = (filter_value)::text::numeric; END IF;
    IF filter_operator = 'gte' THEN RETURN actual_numeric >= (filter_value)::text::numeric; END IF;
    RETURN actual_numeric <= (filter_value)::text::numeric;
  ELSE
    IF pg_catalog.jsonb_typeof(last_value) IS DISTINCT FROM 'string' THEN RETURN true; END IF;
    actual_text := pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.regexp_replace(
      pg_catalog.normalize(last_value #>> '{}', 'NFC'), '^[[:space:]]+|[[:space:]]+$', '', 'g')),
      '[[:space:]]+', ' ', 'g');
    expected_text := pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.regexp_replace(
      pg_catalog.normalize(filter_value #>> '{}', 'NFC'), '^[[:space:]]+|[[:space:]]+$', '', 'g')),
      '[[:space:]]+', ' ', 'g');
    -- A blank constraint value never matches in the loader, even against a
    -- blank variant value.
    IF expected_text = '' THEN RETURN false; END IF;
    RETURN actual_text = expected_text;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_product_variant_recall(
  p_merchant_id uuid,
  p_filters jsonb DEFAULT '[]'::jsonb,
  p_limit integer DEFAULT 2000
) RETURNS TABLE (product_id uuid, attributes jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  -- Anonymous-executable boundary: cap the filter set before expansion, or a
  -- raw caller bypassing the MCP schema could force unbounded regex/parse
  -- CPU across the merchant's variant catalog. The loader never exceeds 50
  -- constraints (5 alternatives × 10 attributes, ~8KB worst case).
  IF pg_catalog.jsonb_typeof(p_filters) = 'array'
    AND (pg_catalog.jsonb_array_length(p_filters) > 50
      OR pg_catalog.octet_length(p_filters::text) > 16384) THEN
    RAISE EXCEPTION 'variant recall accepts at most 50 constraints'
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH filters AS (
    -- Normalize once: a non-array boundary value means no filtering, and
    -- the CASE keeps array expansion away from values that would error.
    SELECT filter_element.value AS filter
    FROM pg_catalog.jsonb_array_elements(
      CASE WHEN pg_catalog.jsonb_typeof(p_filters) = 'array' THEN p_filters ELSE '[]'::jsonb END
    ) AS filter_element
  ),
  eligible AS (
    SELECT pv.product_id, pv.attributes, pv.created_at, pv.id,
      EXISTS (SELECT 1 FROM filters
        WHERE discovery.recall_variant_filter_exactly_matches(pv.attributes, filters.filter)) AS is_exact,
      EXISTS (SELECT 1 FROM filters
        WHERE discovery.recall_variant_filter_loader_accepts(pv.attributes, filters.filter)) AS is_accepted
    FROM public.product_variants AS pv
    JOIN public.products AS p ON p.id = pv.product_id
    JOIN public.merchants AS m ON m.id = p.merchant_id
    WHERE pv.merchant_id = p_merchant_id
      AND p.merchant_id = p_merchant_id
      AND p.status = 'active'
      AND pv.is_inventory_anchor IS NOT TRUE
      AND (
        COALESCE(m.is_published, FALSE) = TRUE
        OR COALESCE(m.is_platform_admin, FALSE) = TRUE
      )
      -- Recall OR: a variant survives when some constraint cannot rule it
      -- out, mirroring the loader.
      AND (
        NOT EXISTS (SELECT 1 FROM filters)
        OR EXISTS (
          SELECT 1 FROM filters
          WHERE NOT discovery.recall_variant_filter_verifiably_fails(pv.attributes, filters.filter)
        )
      )
  ),
  best AS (
    -- One row per product: the cap measures candidate products, so a single
    -- product with thousands of variants cannot evict every other product.
    -- Ordering by acceptance first preserves the loader's product decision
    -- exactly: the representative accepts iff some variant would.
    SELECT DISTINCT ON (eligible.product_id)
      eligible.product_id, eligible.attributes, eligible.is_accepted, eligible.is_exact
    FROM eligible
    ORDER BY eligible.product_id, (NOT eligible.is_accepted), (NOT eligible.is_exact),
      eligible.created_at, eligible.id
  )
  SELECT best.product_id, best.attributes FROM best
  ORDER BY (NOT best.is_accepted), (NOT best.is_exact), best.product_id
  LIMIT least(greatest(coalesce(p_limit, 2000), 1), 2001);
END;
$$;

ALTER FUNCTION public.search_product_variant_recall(uuid, jsonb, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.search_product_variant_recall(uuid, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_product_variant_recall(uuid, jsonb, integer) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.search_product_variant_recall(uuid, jsonb, integer) IS 'Published-merchant variant attributes for discovery recall; filters narrow before the cap; NULL merchant returns no rows.';
