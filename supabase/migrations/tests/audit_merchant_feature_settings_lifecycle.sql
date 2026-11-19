-- Explicit lifecycle, service attribution, identity, and deletion scenarios.

-- Remove the automatic row then exercise an explicit insert/update/clear/delete
-- lifecycle with a full sentinel corpus. This models legacy clients that create
-- a missing settings row themselves.
SELECT pg_catalog.set_config(
  'app.audit_actor_user_id',
  '7e3f2e50-0000-4000-8000-000000000003',
  true
);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '7e3f2e50-0000-4000-8000-000000000003', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object('role', 'authenticated', 'sub',
    '7e3f2e50-0000-4000-8000-000000000003')::text,
  true
);
DELETE FROM public.merchant_feature_settings
WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000004';
INSERT INTO public.merchant_feature_settings (
  merchant_id, credit_direct_public_key, facebook_capi_token, ga4_api_secret,
  shipping_providers, repair_settings, custom_settings, pay_on_delivery_enabled
) VALUES (
  '7e3f2e50-0000-4000-8000-000000000004',
  'task5-credit-direct-public-key-sentinel-QWZX',
  'task5-facebook-capi-sentinel-RSTV',
  'task5-ga4-secret-sentinel-XQWZ',
  '["gigl", "task5-provider-secret-sentinel-ZTVW"]'::jsonb,
  pg_catalog.jsonb_build_object('contact_phone', 'task5-repair-contact-sentinel-WXQR'),
  pg_catalog.jsonb_build_object(
    'google_store_widget_enabled', true,
    'zohoCampaigns', pg_catalog.jsonb_build_object(
      'signingSecret', 'task5-custom-settings-secret-sentinel-QWZX',
      'nested', pg_catalog.jsonb_build_object('token', 'task5-nested-secret-fragment-RSTV')
    ),
    'task5-secret-key', 'task5-suffix-q7w9'
  ),
  false
);
RESET ROLE;

DO $test$
DECLARE v_event record; v_event_found boolean; v_audit_text text;
BEGIN
  SELECT * INTO v_event FROM public.audit_events
  WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000004'
    AND metadata ->> 'category' = 'merchant_feature_settings'
    AND action = 'merchant.feature_settings.create'
  ORDER BY occurred_at DESC, id DESC LIMIT 1;
  v_event_found := FOUND;
  SELECT string_agg(pg_catalog.to_jsonb(audit_event)::text, E'\n') INTO v_audit_text
  FROM public.audit_events AS audit_event
  WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000004'
    AND metadata ->> 'category' = 'merchant_feature_settings';
  IF NOT v_event_found
     OR v_event.actor_user_id IS DISTINCT FROM '7e3f2e50-0000-4000-8000-000000000003'::uuid
     OR v_event.after_values -> 'credentials' -> 'ga4_api_secret'
        IS DISTINCT FROM '{"present":true,"state":"configured"}'::jsonb THEN
    RAISE EXCEPTION 'explicit feature settings insert did not retain safe lifecycle evidence';
  END IF;
  PERFORM pg_temp.assert_task5_redacted_audit_rows(
    v_audit_text,
    ARRAY(
      SELECT value FROM audit_merchant_feature_settings_sentinels
      WHERE lifecycle = 'create' ORDER BY value
    ),
    'explicit insert'
  );
END;
$test$;

-- A service mutation of two settings rows emits one event per row and shares
-- the writer-generated transaction identifier without trusting a caller value.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT pg_catalog.set_config(
  'app.audit_database_transaction_id',
  'task5-hostile-transaction-identifier',
  true
);
UPDATE public.merchant_feature_settings
SET pay_on_delivery_enabled = false
WHERE merchant_id IN (
  '7e3f2e50-0000-4000-8000-000000000002',
  '7e3f2e50-0000-4000-8000-000000000004'
);
UPDATE public.merchant_feature_settings
SET pay_on_delivery_enabled = true
WHERE merchant_id IN (
  '7e3f2e50-0000-4000-8000-000000000002',
  '7e3f2e50-0000-4000-8000-000000000004'
);
RESET ROLE;
DO $test$
DECLARE
  v_current_transaction_id text := pg_catalog.pg_current_xact_id()::text;
  v_service_principal_count integer;
  v_writer_transaction_count integer;
BEGIN
  SELECT count(*) INTO v_writer_transaction_count
  FROM public.audit_events
  WHERE merchant_id IN (
    '7e3f2e50-0000-4000-8000-000000000002',
    '7e3f2e50-0000-4000-8000-000000000004'
  )
    AND metadata ->> 'category' = 'merchant_feature_settings'
    AND action = 'merchant.feature_settings.update'
    AND after_values ->> 'pay_on_delivery_enabled' = 'true'
    AND database_transaction_id = v_current_transaction_id;
  SELECT count(*) INTO v_service_principal_count
  FROM public.audit_events
  WHERE merchant_id IN (
    '7e3f2e50-0000-4000-8000-000000000002',
    '7e3f2e50-0000-4000-8000-000000000004'
  )
    AND metadata ->> 'category' = 'merchant_feature_settings'
    AND action = 'merchant.feature_settings.update'
    AND after_values ->> 'pay_on_delivery_enabled' = 'true'
    AND actor_user_id IS NULL
    AND actor_type = 'service'
    AND actor_label = 'service_role'
    AND source = 'api';
  IF (
    SELECT count(*) FROM public.audit_events
    WHERE merchant_id IN (
      '7e3f2e50-0000-4000-8000-000000000002',
      '7e3f2e50-0000-4000-8000-000000000004'
    )
      AND metadata ->> 'category' = 'merchant_feature_settings'
      AND action = 'merchant.feature_settings.update'
      AND after_values ->> 'pay_on_delivery_enabled' = 'true'
  ) IS DISTINCT FROM 2
     OR v_writer_transaction_count IS DISTINCT FROM 2
     OR v_service_principal_count IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'multi-row service mutation did not create grouped service-principal audit events';
  END IF;
END;
$test$;

-- ID and tenant reassignment must never repoint a settings event to a different
-- resource or merchant. Use service role to reach the trigger before RLS.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DELETE FROM public.merchant_feature_settings
WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000006';
DO $test$
DECLARE v_id_reassignment_rejected boolean := false; v_merchant_reassignment_rejected boolean := false;
BEGIN
  BEGIN
    UPDATE public.merchant_feature_settings
    SET id = extensions.gen_random_uuid()
    WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM IS DISTINCT FROM 'audit_merchant_feature_settings_id_reassignment_forbidden' THEN
      RAISE;
    END IF;
    v_id_reassignment_rejected := true;
  END;
  BEGIN
    UPDATE public.merchant_feature_settings
    SET merchant_id = '7e3f2e50-0000-4000-8000-000000000006'
    WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000002';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM IS DISTINCT FROM 'audit_merchant_feature_settings_merchant_reassignment_forbidden' THEN
      RAISE;
    END IF;
    v_merchant_reassignment_rejected := true;
  END;
  IF NOT v_id_reassignment_rejected OR NOT v_merchant_reassignment_rejected THEN
    RAISE EXCEPTION 'feature settings row identity reassignment was not rejected';
  END IF;
END;
$test$;
RESET ROLE;

-- Deleting the explicit row captures its prior safe state and scans every
-- stored audit field for raw and derived credential leaks.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '7e3f2e50-0000-4000-8000-000000000003', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object('role', 'authenticated', 'sub',
    '7e3f2e50-0000-4000-8000-000000000003')::text,
  true
);
UPDATE public.merchant_feature_settings
SET credit_direct_public_key = 'task5-credit-direct-public-key-delete-WXQR',
    facebook_capi_token = 'task5-facebook-capi-delete-ZTVW',
    ga4_api_secret = 'task5-ga4-secret-delete-QXWZ',
    custom_settings = pg_catalog.jsonb_build_object(
      'zohoCampaigns', pg_catalog.jsonb_build_object(
        'signingSecret', 'task5-custom-settings-secret-delete-RSTV',
        'nested', pg_catalog.jsonb_build_object('token', 'task5-nested-secret-delete-QWZX')
      )
    )
WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000004';
DELETE FROM public.merchant_feature_settings
WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000004';
RESET ROLE;

DO $test$
DECLARE v_event record; v_event_found boolean; v_audit_text text;
BEGIN
  SELECT * INTO v_event FROM public.audit_events
  WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000004'
    AND metadata ->> 'category' = 'merchant_feature_settings'
    AND action = 'merchant.feature_settings.delete'
  ORDER BY occurred_at DESC, id DESC LIMIT 1;
  v_event_found := FOUND;
  SELECT string_agg(pg_catalog.to_jsonb(audit_event)::text, E'\n') INTO v_audit_text
  FROM public.audit_events AS audit_event
  WHERE merchant_id = '7e3f2e50-0000-4000-8000-000000000004'
    AND metadata ->> 'category' = 'merchant_feature_settings';
  IF NOT v_event_found
     OR v_event.actor_user_id IS DISTINCT FROM '7e3f2e50-0000-4000-8000-000000000003'::uuid
     OR v_event.before_values -> 'credentials' -> 'ga4_api_secret'
        IS DISTINCT FROM '{"present":true}'::jsonb THEN
    RAISE EXCEPTION 'feature settings deletion did not retain safe prior state';
  END IF;
  PERFORM pg_temp.assert_task5_redacted_audit_rows(
    v_audit_text,
    ARRAY(
      SELECT value FROM audit_merchant_feature_settings_sentinels
      WHERE lifecycle IN ('create', 'delete') ORDER BY value
    ),
    'explicit delete'
  );
END;
$test$;
