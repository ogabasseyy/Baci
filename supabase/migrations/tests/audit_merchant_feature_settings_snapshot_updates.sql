-- Wide-update, credential-clear, no-op, and rollback scenarios.

-- A wide client PUT must retain accurate credential baselines: changed
-- credentials get a transition, while unchanged credentials stay presence-only.
INSERT INTO audit_merchant_feature_settings_counts
SELECT 'wide-update-before', count(*)
FROM public.audit_events
WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002'
  AND metadata ->> 'category' = 'merchant_feature_settings';
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '7e3f2e50-0000-4000-8000-000000000001', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object('role', 'authenticated', 'sub',
    '7e3f2e50-0000-4000-8000-000000000001')::text,
  true
);
DO $test$
DECLARE
  v_assignments text;
  v_assignment_count integer;
  v_unsupported_count integer;
BEGIN
  WITH exact_columns AS (
    SELECT column_name, data_type, ordinal_position
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'merchant_feature_settings'
      AND column_name NOT IN (
        'id', 'merchant_id', 'created_at', 'custom_robots_txt', 'updated_at',
        'credit_direct_public_key', 'custom_settings', 'facebook_capi_token',
        'chatgpt_pixel_id', 'facebook_pixel_id', 'ga4_api_secret', 'google_analytics_id',
        'google_place_id', 'repair_settings', 'shipping_providers',
        'snapchat_capi_token', 'snapchat_pixel_id', 'tiktok_access_token',
        'tiktok_pixel_id', 'twitter_pixel_id'
      )
  ), assignments AS (
    SELECT
      ordinal_position,
      CASE
        WHEN column_name IN (
          'preferred_international_gateway', 'preferred_local_gateway'
        ) THEN format(
          '%I = CASE WHEN %I = %L THEN %L ELSE %L END',
          column_name, column_name, 'paystack', 'korapay', 'paystack'
        )
        WHEN column_name = 'vtu_checkout_addon_amounts' THEN
          format('%I = ARRAY[321, 654]::integer[]', column_name)
        WHEN data_type = 'boolean' THEN
          format('%I = NOT COALESCE(%I, false)', column_name, column_name)
        WHEN data_type IN (
          'bigint', 'integer', 'numeric', 'real', 'smallint', 'double precision'
        ) THEN format('%I = COALESCE(%I, 0) + 1', column_name, column_name)
      END AS assignment
    FROM exact_columns
  )
  SELECT
    string_agg(assignment, ', ' ORDER BY ordinal_position),
    count(*),
    count(*) FILTER (WHERE assignment IS NULL)
  INTO v_assignments, v_assignment_count, v_unsupported_count
  FROM assignments;

  IF v_assignment_count IS DISTINCT FROM 62
     OR v_unsupported_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'wide feature settings fixture no longer covers every exact field';
  END IF;

  v_assignments := v_assignments || format(
    ', facebook_capi_token = %L', 'task5-facebook-capi-wide-rotated-VWXY'
  );
  EXECUTE format(
    'UPDATE public.merchant_feature_settings SET %s WHERE merchant_id = %L',
    v_assignments,
    '7e3f2e50-0000-4000-8000-000000000002'
  );
END;
$test$;
RESET ROLE;

DO $test$
DECLARE v_event record; v_before_count integer; v_after_count integer; v_audit_text text;
BEGIN
  SELECT event_count INTO v_before_count FROM audit_merchant_feature_settings_counts
  WHERE label = 'wide-update-before';
  SELECT count(*) INTO v_after_count FROM public.audit_events
  WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002'
    AND metadata ->> 'category' = 'merchant_feature_settings';
  SELECT * INTO v_event FROM public.audit_events
  WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002'
    AND metadata ->> 'category' = 'merchant_feature_settings'
    AND action = 'merchant.feature_settings.update'
  ORDER BY occurred_at DESC, id DESC LIMIT 1;
  SELECT string_agg(pg_catalog.to_jsonb(audit_event)::text, E'\n') INTO v_audit_text
  FROM public.audit_events AS audit_event
  WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002'
    AND metadata ->> 'category' = 'merchant_feature_settings';
  IF v_after_count IS DISTINCT FROM v_before_count + 1
     OR v_event.changed_fields IS DISTINCT FROM ARRAY['settings_snapshot']::text[]
     OR v_event.before_values -> 'credentials' -> 'credit_direct_public_key'
        IS DISTINCT FROM '{"present":true}'::jsonb
     OR v_event.after_values -> 'credentials' -> 'credit_direct_public_key'
        IS DISTINCT FROM '{"present":true}'::jsonb
     OR v_event.after_values -> 'credentials' -> 'facebook_capi_token'
        IS DISTINCT FROM '{"present":true,"state":"rotated"}'::jsonb
     OR v_event.after_values -> 'credentials' -> 'custom_settings'
        IS DISTINCT FROM '{"present":true}'::jsonb THEN
    RAISE EXCEPTION 'wide feature settings update misrepresented credential baselines';
  END IF;
  PERFORM pg_temp.assert_task5_redacted_audit_rows(
    v_audit_text,
    ARRAY(
      SELECT value FROM audit_merchant_feature_settings_sentinels
      WHERE lifecycle IN ('create', 'rotation') ORDER BY value
    ),
    'wide update'
  );
END;
$test$;

-- A clear is distinct from a rotation and must also scan the complete stored
-- audit row, including the old values that contain credential state.
INSERT INTO audit_merchant_feature_settings_counts
SELECT 'primary-clear-before', count(*)
FROM public.audit_events
WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002'
  AND metadata ->> 'category' = 'merchant_feature_settings';
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '7e3f2e50-0000-4000-8000-000000000001', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object('role', 'authenticated', 'sub',
    '7e3f2e50-0000-4000-8000-000000000001')::text,
  true
);
UPDATE public.merchant_feature_settings
SET credit_direct_public_key = NULL,
    ga4_api_secret = NULL,
    custom_settings = '{}'::jsonb
WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002';
RESET ROLE;

DO $test$
DECLARE v_event record; v_before_count integer; v_after_count integer; v_audit_text text;
BEGIN
  SELECT event_count INTO v_before_count FROM audit_merchant_feature_settings_counts
  WHERE label = 'primary-clear-before';
  SELECT count(*) INTO v_after_count FROM public.audit_events
  WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002'
    AND metadata ->> 'category' = 'merchant_feature_settings';
  SELECT * INTO v_event FROM public.audit_events
  WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002'
    AND metadata ->> 'category' = 'merchant_feature_settings'
  ORDER BY occurred_at DESC, id DESC LIMIT 1;
  SELECT string_agg(pg_catalog.to_jsonb(audit_event)::text, E'\n') INTO v_audit_text
  FROM public.audit_events AS audit_event
  WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002'
    AND metadata ->> 'category' = 'merchant_feature_settings';
  IF v_after_count IS DISTINCT FROM v_before_count + 1
     OR v_event.after_values -> 'credit_direct_public_key'
        IS DISTINCT FROM '{"present":false,"state":"cleared"}'::jsonb
     OR v_event.after_values -> 'ga4_api_secret'
        IS DISTINCT FROM '{"present":false,"state":"cleared"}'::jsonb
     OR v_event.after_values -> 'custom_settings'
        IS DISTINCT FROM '{"present":false,"state":"cleared","changed_safe_keys":[]}'::jsonb THEN
    RAISE EXCEPTION 'credential clear was not safely represented';
  END IF;
  PERFORM pg_temp.assert_task5_redacted_audit_rows(
    v_audit_text,
    ARRAY(
      SELECT value FROM audit_merchant_feature_settings_sentinels
      WHERE lifecycle IN ('create', 'rotation', 'clear') ORDER BY value
    ),
    'primary clear'
  );
END;
$test$;

-- A semantic no-op and an updated_at-only write must not produce events.
INSERT INTO audit_merchant_feature_settings_counts
SELECT 'no-op-before', count(*)
FROM public.audit_events
WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002'
  AND metadata ->> 'category' = 'merchant_feature_settings';
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '7e3f2e50-0000-4000-8000-000000000001', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object('role', 'authenticated', 'sub',
    '7e3f2e50-0000-4000-8000-000000000001')::text,
  true
);
UPDATE public.merchant_feature_settings
SET paystack_enabled = paystack_enabled
WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002';
UPDATE public.merchant_feature_settings
SET updated_at = updated_at + interval '1 second'
WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002';
UPDATE public.merchant_feature_settings
SET custom_robots_txt = 'User-agent: *\nDisallow: /task5-ignored'
WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002';
RESET ROLE;
DO $test$
BEGIN
  IF (
    SELECT count(*) FROM public.audit_events
    WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002'
      AND metadata ->> 'category' = 'merchant_feature_settings'
  ) IS DISTINCT FROM (
    SELECT event_count FROM audit_merchant_feature_settings_counts
    WHERE label = 'no-op-before'
  ) THEN
    RAISE EXCEPTION 'semantic no-op or updated_at-only feature settings write emitted an audit event';
  END IF;
END;
$test$;

-- An audited mutation that rolls back must not leave a committed audit row.
INSERT INTO audit_merchant_feature_settings_counts
SELECT 'rollback-before', count(*)
FROM public.audit_events
WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002'
  AND metadata ->> 'category' = 'merchant_feature_settings';
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '7e3f2e50-0000-4000-8000-000000000001', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object('role', 'authenticated', 'sub',
    '7e3f2e50-0000-4000-8000-000000000001')::text,
  true
);
SAVEPOINT task5_rollback;
UPDATE public.merchant_feature_settings
SET paystack_enabled = false
WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002';
RESET ROLE;
DO $test$
BEGIN
  IF (
    SELECT count(*) FROM public.audit_events
    WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002'
      AND metadata ->> 'category' = 'merchant_feature_settings'
  ) IS DISTINCT FROM (
    SELECT event_count + 1 FROM audit_merchant_feature_settings_counts
    WHERE label = 'rollback-before'
  ) THEN
    RAISE EXCEPTION 'audited feature settings mutation did not emit before rollback';
  END IF;
END;
$test$;
ROLLBACK TO SAVEPOINT task5_rollback;
RESET ROLE;
DO $test$
BEGIN
  IF (
    SELECT count(*) FROM public.audit_events
    WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002'
      AND metadata ->> 'category' = 'merchant_feature_settings'
  ) IS DISTINCT FROM (
    SELECT event_count FROM audit_merchant_feature_settings_counts
    WHERE label = 'rollback-before'
  ) THEN
    RAISE EXCEPTION 'rolled-back feature settings mutation left an audit event';
  END IF;
END;
$test$;
