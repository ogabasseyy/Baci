-- Authenticated update, safe numeric, and secret-rotation scenarios.

-- New columns must fail closed for a direct update, rather than only when an
-- unrelated known column happens to be written alongside them.
ALTER TABLE public.merchant_feature_settings
  ADD COLUMN audit_merchant_feature_settings_unclassified_probe text;
DO $test$
BEGIN
  BEGIN
    UPDATE public.merchant_feature_settings
    SET audit_merchant_feature_settings_unclassified_probe = 'task5-unclassified'
    WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'unclassified feature setting unexpectedly bypassed audit guard';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM IS DISTINCT FROM 'audit_merchant_feature_settings_unclassified_column' THEN
      RAISE;
    END IF;
  END;
END;
$test$;
ALTER TABLE public.merchant_feature_settings
  DROP COLUMN audit_merchant_feature_settings_unclassified_probe;

-- The web API, dashboard, and older/mobile clients all reduce to an ordinary
-- authenticated row update. Preserve safe gateway and checkout values while
-- redacting every credential and nested custom setting.
-- The automatic settings row above needs a database principal. Clear it before
-- client-shaped writes so their actor evidence must come from the JWT subject.
SELECT pg_catalog.set_config('app.audit_actor_user_id', '', true);
INSERT INTO audit_merchant_feature_settings_counts
SELECT 'primary-update-before', count(*)
FROM public.audit_events
WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002'
  AND metadata ->> 'category' = 'merchant_feature_settings';

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '7e3f2e50-0000-4000-8000-000000000001', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'role', 'authenticated',
    'sub', '7e3f2e50-0000-4000-8000-000000000001'
  )::text,
  true
);
UPDATE public.merchant_feature_settings
SET paystack_enabled = false,
    korapay_enabled = true,
    credit_direct_enabled = true,
    credpal_enabled = true,
    juicyway_enabled = true,
    pay_on_delivery_enabled = false,
    preferred_local_gateway = 'korapay',
    preferred_international_gateway = 'paystack',
    checkout_collect_phone = false,
    checkout_require_account = true,
    checkout_show_order_notes = false,
    credit_direct_min_amount = 20000,
    credit_direct_max_amount = 250000,
    klump_enabled = true,
    klump_min_amount = 15000,
    klump_max_amount = 350000,
    free_shipping_threshold = 5000,
    shipping_providers = '["gigl", "task5-provider-secret-sentinel-ZTVW"]'::jsonb,
    vtu_checkout_addon_amounts = ARRAY[200, 500, 1000],
    credit_direct_public_key = 'task5-credit-direct-public-key-sentinel-QWZX',
    facebook_capi_token = 'task5-facebook-capi-sentinel-RSTV',
    ga4_api_secret = 'task5-ga4-secret-sentinel-XQWZ',
    repair_settings = pg_catalog.jsonb_build_object(
      'contact_phone', 'task5-repair-contact-sentinel-WXQR'
    ),
    custom_settings = pg_catalog.jsonb_build_object(
      'google_store_widget_enabled', true,
      'zohoCampaigns', pg_catalog.jsonb_build_object(
        'signingSecret', 'task5-custom-settings-secret-sentinel-QWZX',
        'nested', pg_catalog.jsonb_build_object(
          'token', 'task5-nested-secret-fragment-RSTV'
        )
      ),
      'task5-secret-key', 'task5-suffix-q7w9'
    )
WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002';
RESET ROLE;

DO $test$
DECLARE
  v_event record;
  v_before_count integer;
  v_after_count integer;
  v_audit_text text;
BEGIN
  SELECT event_count INTO v_before_count
  FROM audit_merchant_feature_settings_counts WHERE label = 'primary-update-before';
  SELECT count(*) INTO v_after_count
  FROM public.audit_events
  WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002'
    AND metadata ->> 'category' = 'merchant_feature_settings';
  SELECT * INTO v_event
  FROM public.audit_events
  WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002'
    AND metadata ->> 'category' = 'merchant_feature_settings'
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1;
  SELECT string_agg(pg_catalog.to_jsonb(audit_event)::text, E'\n')
    INTO v_audit_text
  FROM public.audit_events AS audit_event
  WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002'
    AND metadata ->> 'category' = 'merchant_feature_settings';

  IF v_after_count IS DISTINCT FROM v_before_count + 1
     OR v_event.action IS DISTINCT FROM 'merchant.feature_settings.update'
     OR v_event.actor_user_id IS DISTINCT FROM '7e3f2e50-0000-4000-8000-000000000001'::uuid
     OR v_event.after_values ->> 'paystack_enabled' IS DISTINCT FROM 'false'
     OR v_event.after_values ->> 'korapay_enabled' IS DISTINCT FROM 'true'
     OR v_event.after_values ->> 'credit_direct_enabled' IS DISTINCT FROM 'true'
     OR v_event.after_values ->> 'credpal_enabled' IS DISTINCT FROM 'true'
     OR v_event.after_values ->> 'juicyway_enabled' IS DISTINCT FROM 'true'
     OR v_event.after_values ->> 'preferred_local_gateway' IS DISTINCT FROM 'korapay'
     OR v_event.after_values ->> 'preferred_international_gateway' IS DISTINCT FROM 'paystack'
     OR v_event.after_values ->> 'checkout_collect_phone' IS DISTINCT FROM 'false'
     OR COALESCE((v_event.after_values ->> 'credit_direct_min_amount')::numeric, -1)
        IS DISTINCT FROM 20000
     OR COALESCE((v_event.after_values ->> 'credit_direct_max_amount')::numeric, -1)
        IS DISTINCT FROM 250000
     OR v_event.after_values -> 'vtu_checkout_addon_amounts'
        IS DISTINCT FROM '[200,500,1000]'::jsonb
     OR v_event.after_values -> 'credit_direct_public_key'
        IS DISTINCT FROM '{"present":true,"state":"configured"}'::jsonb
     OR v_event.after_values -> 'ga4_api_secret'
        IS DISTINCT FROM '{"present":true,"state":"configured"}'::jsonb
     OR v_event.after_values -> 'custom_settings'
        IS DISTINCT FROM '{"present":true,"state":"configured","changed_safe_keys":["google_store_widget_enabled"]}'::jsonb
     OR NOT (v_event.changed_fields @> ARRAY[
       'paystack_enabled', 'korapay_enabled', 'credit_direct_enabled',
       'credpal_enabled', 'juicyway_enabled', 'preferred_local_gateway',
       'checkout_collect_phone', 'credit_direct_min_amount',
       'credit_direct_max_amount', 'credit_direct_public_key',
       'ga4_api_secret', 'custom_settings', 'shipping_providers'
     ]::text[])
     OR v_event.database_transaction_id IS NULL THEN
    RAISE EXCEPTION 'feature settings update omitted safe evidence or actor attribution';
  END IF;

  PERFORM pg_temp.assert_task5_redacted_audit_rows(
    v_audit_text,
    ARRAY(
      SELECT value FROM audit_merchant_feature_settings_sentinels
      WHERE lifecycle = 'create' ORDER BY value
    ),
    'primary update'
  );
END;
$test$;

-- The current API schema and table domain accept negative threshold values.
-- They are safe numeric configuration, so the audit record must retain the
-- exact before/after values instead of collapsing valid writes to a marker.
INSERT INTO audit_merchant_feature_settings_counts
SELECT 'negative-threshold-before', count(*)
FROM public.audit_events
WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002'
  AND metadata ->> 'category' = 'merchant_feature_settings';
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '7e3f2e50-0000-4000-8000-000000000001', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'role', 'authenticated',
    'sub', '7e3f2e50-0000-4000-8000-000000000001'
  )::text,
  true
);
UPDATE public.merchant_feature_settings
SET free_shipping_threshold = -1,
    low_stock_threshold = -5
WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002';
RESET ROLE;

DO $test$
DECLARE
  v_event record;
  v_before_count integer;
  v_after_count integer;
BEGIN
  SELECT event_count INTO v_before_count
  FROM audit_merchant_feature_settings_counts
  WHERE label = 'negative-threshold-before';
  SELECT count(*) INTO v_after_count
  FROM public.audit_events
  WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002'
    AND metadata ->> 'category' = 'merchant_feature_settings';
  SELECT * INTO v_event
  FROM public.audit_events
  WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002'
    AND metadata ->> 'category' = 'merchant_feature_settings'
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1;

  IF v_after_count IS DISTINCT FROM v_before_count + 1
     OR (v_event.before_values ->> 'free_shipping_threshold')::numeric
        IS DISTINCT FROM 5000
     OR (v_event.after_values ->> 'free_shipping_threshold')::numeric
        IS DISTINCT FROM -1
     OR (v_event.before_values ->> 'low_stock_threshold')::integer
        IS DISTINCT FROM 10
     OR (v_event.after_values ->> 'low_stock_threshold')::integer
        IS DISTINCT FROM -5 THEN
    RAISE EXCEPTION 'negative threshold values lost exact audit evidence';
  END IF;
END;
$test$;

-- Rotating a secret still produces a useful state transition without exposing
-- either version or arbitrary top-level custom-setting keys.
INSERT INTO audit_merchant_feature_settings_counts
SELECT 'primary-rotation-before', count(*)
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
SET credit_direct_public_key = 'task5-credit-direct-public-key-rotated-RSTV',
    ga4_api_secret = 'task5-ga4-secret-rotated-QWZX',
    custom_settings = pg_catalog.jsonb_build_object(
      'google_store_widget_enabled', true,
      'zohoCampaigns', pg_catalog.jsonb_build_object(
        'signingSecret', 'task5-custom-settings-secret-rotated-XQTR'
      )
    )
WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002';
RESET ROLE;

DO $test$
DECLARE v_event record; v_before_count integer; v_after_count integer; v_audit_text text;
BEGIN
  SELECT event_count INTO v_before_count FROM audit_merchant_feature_settings_counts
  WHERE label = 'primary-rotation-before';
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
        IS DISTINCT FROM '{"present":true,"state":"rotated"}'::jsonb
     OR v_event.after_values -> 'ga4_api_secret'
        IS DISTINCT FROM '{"present":true,"state":"rotated"}'::jsonb
     OR v_event.after_values -> 'custom_settings'
        IS DISTINCT FROM '{"present":true,"state":"rotated","changed_safe_keys":[]}'::jsonb THEN
    RAISE EXCEPTION 'credential rotation was not safely represented';
  END IF;
  PERFORM pg_temp.assert_task5_redacted_audit_rows(
    v_audit_text,
    ARRAY(
      SELECT value FROM audit_merchant_feature_settings_sentinels
      WHERE lifecycle IN ('create', 'rotation') ORDER BY value
    ),
    'primary rotation'
  );
END;
$test$;
