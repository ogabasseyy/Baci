-- Shared Task 5 fixture setup. Included by the wrapper within one transaction.

CREATE TEMP TABLE audit_merchant_feature_settings_counts (
  label text PRIMARY KEY,
  event_count integer NOT NULL
);

CREATE TEMP TABLE audit_merchant_feature_settings_sentinels (
  lifecycle text NOT NULL,
  value text NOT NULL,
  PRIMARY KEY (lifecycle, value)
);

CREATE FUNCTION pg_temp.assert_task5_redacted_audit_rows(
  p_audit_text text,
  p_sentinels text[],
  p_lifecycle text
)
RETURNS void
LANGUAGE plpgsql
AS $assert$
DECLARE
  v_sentinel text;
  v_suffix text;
  v_masked_suffix text;
  v_fixed_width_masked_suffix text;
  v_md5 text;
  v_sha256 text;
BEGIN
  IF NULLIF(p_audit_text, '') IS NULL THEN
    RAISE EXCEPTION '% redaction assertion did not receive serialized audit rows',
      p_lifecycle;
  END IF;
  IF COALESCE(pg_catalog.cardinality(p_sentinels), 0) = 0 THEN
    RAISE EXCEPTION '% redaction assertion did not receive sentinel corpus',
      p_lifecycle;
  END IF;

  FOREACH v_sentinel IN ARRAY p_sentinels LOOP
    v_suffix := pg_catalog.right(v_sentinel, 4);
    v_masked_suffix := '****' || v_suffix;
    v_fixed_width_masked_suffix := pg_catalog.repeat(
      '*',
      GREATEST(pg_catalog.char_length(v_sentinel) - pg_catalog.char_length(v_suffix), 1)
    ) || v_suffix;
    v_md5 := pg_catalog.md5(v_sentinel);
    v_sha256 := pg_catalog.encode(extensions.digest(v_sentinel, 'sha256'), 'hex');

    IF pg_catalog.strpos(p_audit_text, v_sentinel) > 0
       OR pg_catalog.strpos(p_audit_text, v_suffix) > 0
       OR pg_catalog.strpos(p_audit_text, v_masked_suffix) > 0
       OR pg_catalog.strpos(p_audit_text, v_fixed_width_masked_suffix) > 0
       OR pg_catalog.strpos(p_audit_text, v_md5) > 0
       OR pg_catalog.strpos(p_audit_text, v_sha256) > 0 THEN
      RAISE EXCEPTION '% audit row leaked raw, suffix, masked, or unsalted-hash sensitive evidence',
        p_lifecycle;
    END IF;
  END LOOP;
END;
$assert$;

DO $test$
BEGIN
  BEGIN
    PERFORM pg_temp.assert_task5_redacted_audit_rows(
      '{"event":"task5-empty-sentinel-corpus"}',
      ARRAY[]::text[],
      'empty sentinel corpus'
    );
    RAISE EXCEPTION 'redaction assertion unexpectedly accepted an empty sentinel corpus';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM IS DISTINCT FROM
      'empty sentinel corpus redaction assertion did not receive sentinel corpus' THEN
      RAISE;
    END IF;
  END;
END;
$test$;

INSERT INTO audit_merchant_feature_settings_sentinels (lifecycle, value) VALUES
  ('create', 'task5-credit-direct-public-key-sentinel-QWZX'),
  ('create', 'task5-facebook-capi-sentinel-RSTV'),
  ('create', 'task5-ga4-secret-sentinel-XQWZ'),
  ('create', 'task5-custom-settings-secret-sentinel-QWZX'),
  ('create', 'task5-nested-secret-fragment-RSTV'),
  ('create', 'task5-suffix-q7w9'),
  ('create', 'task5-repair-contact-sentinel-WXQR'),
  ('create', 'task5-provider-secret-sentinel-ZTVW'),
  ('rotation', 'task5-credit-direct-public-key-rotated-RSTV'),
  ('rotation', 'task5-facebook-capi-wide-rotated-VWXY'),
  ('rotation', 'task5-ga4-secret-rotated-QWZX'),
  ('rotation', 'task5-custom-settings-secret-rotated-XQTR'),
  ('clear', 'task5-credit-direct-public-key-rotated-RSTV'),
  ('clear', 'task5-ga4-secret-rotated-QWZX'),
  ('clear', 'task5-custom-settings-secret-rotated-XQTR'),
  ('delete', 'task5-credit-direct-public-key-delete-WXQR'),
  ('delete', 'task5-facebook-capi-delete-ZTVW'),
  ('delete', 'task5-ga4-secret-delete-QXWZ'),
  ('delete', 'task5-custom-settings-secret-delete-RSTV'),
  ('delete', 'task5-nested-secret-delete-QWZX');

DO $test$
DECLARE
  v_actor_id uuid := '7e3f2e50-0000-4000-8000-000000000001';
  v_primary_merchant_id uuid := '7e3f2e50-0000-4000-8000-000000000002';
  v_manual_owner_id uuid := '7e3f2e50-0000-4000-8000-000000000003';
  v_manual_merchant_id uuid := '7e3f2e50-0000-4000-8000-000000000004';
  v_target_owner_id uuid := '7e3f2e50-0000-4000-8000-000000000005';
  v_target_merchant_id uuid := '7e3f2e50-0000-4000-8000-000000000006';
  v_primary_settings_id uuid;
  v_live_columns text[];
  v_exact_columns text[] := ARRAY[
    'about_page_enabled', 'agentic_checkout_enabled', 'auto_blog_enabled',
    'auto_generate_schema', 'blog_discover_image_validation_enabled',
    'blog_enabled', 'checkout_collect_phone', 'checkout_require_account',
    'checkout_show_order_notes', 'contact_page_enabled', 'credit_direct_enabled',
    'credit_direct_max_amount', 'credit_direct_min_amount', 'credpal_enabled',
    'customer_device_savings_auto_debit_enabled',
    'customer_device_savings_break_fee_enabled',
    'customer_device_savings_enabled', 'discount_codes_enabled',
    'email_notifications_enabled', 'faq_page_enabled', 'free_shipping_threshold',
    'google_reviews_enabled', 'guest_checkout_enabled', 'juicyway_enabled',
    'klump_enabled', 'klump_max_amount', 'klump_min_amount', 'korapay_enabled',
    'low_stock_threshold', 'loyalty_enabled', 'order_tracking_enabled',
    'pay_on_delivery_enabled', 'paystack_enabled',
    'preferred_international_gateway', 'preferred_local_gateway',
    'privacy_page_enabled', 'repairs_catalog_enabled', 'reviews_enabled',
    'rewards_page_enabled', 'shipping_insurance_enabled',
    'shipping_insurance_min_order_value', 'shipping_insurance_opt_in_default',
    'shipping_markup_percentage', 'show_recent_purchases', 'show_stock_levels',
    'sms_notifications_enabled', 'terms_page_enabled', 'vtu_airtime_enabled',
    'vtu_betting_enabled', 'vtu_checkout_addon_amounts',
    'vtu_checkout_addon_enabled', 'vtu_customer_cashback_enabled',
    'vtu_customer_cashback_rate', 'vtu_data_enabled', 'vtu_electricity_enabled',
    'vtu_enabled', 'vtu_loyalty_reward_enabled', 'vtu_merchant_commission_rate',
    'vtu_tv_enabled', 'wallet_order_auto_debit_enabled',
    'wallet_paystack_dva_enabled', 'wishlist_enabled'
  ];
  v_presence_columns text[] := ARRAY[
    'credit_direct_public_key', 'custom_settings', 'facebook_capi_token',
    'chatgpt_pixel_id', 'facebook_pixel_id', 'ga4_api_secret', 'google_analytics_id',
    'google_place_id', 'repair_settings', 'shipping_providers',
    'snapchat_capi_token', 'snapchat_pixel_id', 'tiktok_access_token',
    'tiktok_pixel_id', 'twitter_pixel_id'
  ];
  v_ignored_columns text[] := ARRAY[
    'created_at', 'custom_robots_txt', 'updated_at'
  ];
  v_forbidden_columns text[] := ARRAY['id', 'merchant_id'];
  v_classified_columns text[];
  v_event record;
  v_event_found boolean;
  v_after_value_keys text[];
BEGIN
  v_classified_columns := v_exact_columns || v_presence_columns ||
    v_ignored_columns || v_forbidden_columns;

  SELECT array_agg(column_name ORDER BY column_name)
    INTO v_live_columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'merchant_feature_settings';

  IF (SELECT count(*) FROM unnest(v_classified_columns)) <>
       (SELECT count(DISTINCT column_name)
        FROM unnest(v_classified_columns) AS column_name)
     OR v_live_columns IS DISTINCT FROM (
       SELECT array_agg(column_name ORDER BY column_name)
       FROM unnest(v_classified_columns) AS column_name
     ) THEN
    RAISE EXCEPTION 'public.merchant_feature_settings Task 5 audit classification is incomplete or overlapping';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = 'private.audit_merchant_feature_settings_change_v1()'::regprocedure
      AND prosecdef
  ) THEN
    RAISE EXCEPTION 'merchant feature settings trigger wrapper must be SECURITY DEFINER';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS role_name
    WHERE has_function_privilege(
      role_name,
      'private.audit_merchant_feature_settings_change_v1()'::regprocedure,
      'EXECUTE'
    )
  ) THEN
    RAISE EXCEPTION 'merchant feature settings wrapper is directly executable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'audit_merchant_feature_settings_change_v1'
      AND tgrelid = 'public.merchant_feature_settings'::regclass
      AND tgfoid = 'private.audit_merchant_feature_settings_change_v1()'::regprocedure
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'merchant feature settings audit trigger missing';
  END IF;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_actor_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', 'task5-primary-owner@example.com', 'test', now(),
      now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_manual_owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', 'task5-manual-owner@example.com', 'test', now(),
      now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_target_owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', 'task5-target-owner@example.com', 'test', now(),
      now(), now(), '{}'::jsonb, '{}'::jsonb);

  PERFORM pg_catalog.set_config('app.audit_actor_user_id', v_actor_id::text, true);
  INSERT INTO public.merchants (
    id, user_id, email, phone, business_name, slug, country, support_email,
    support_phone
  ) VALUES
    (v_primary_merchant_id, v_actor_id, 'task5-primary@example.com',
      '+2348010101001', 'Task 5 Primary Store', 'task5-primary-store', 'Nigeria',
      'support-task5-primary@example.com', '+2348010101002'),
    (v_manual_merchant_id, v_manual_owner_id, 'task5-manual@example.com',
      '+2348010101003', 'Task 5 Manual Store', 'task5-manual-store', 'Nigeria',
      'support-task5-manual@example.com', '+2348010101004'),
    (v_target_merchant_id, v_target_owner_id, 'task5-target@example.com',
      '+2348010101005', 'Task 5 Target Store', 'task5-target-store', 'Nigeria',
      'support-task5-target@example.com', '+2348010101006');

  SELECT id INTO v_primary_settings_id
  FROM public.merchant_feature_settings
  WHERE merchant_id = v_primary_merchant_id;
  SELECT * INTO v_event
  FROM public.audit_events
  WHERE merchant_id = v_primary_merchant_id
    AND metadata ->> 'category' = 'merchant_feature_settings'
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1;
  v_event_found := FOUND;
  SELECT array_agg(key ORDER BY key) INTO v_after_value_keys
  FROM pg_catalog.jsonb_object_keys(v_event.after_values) AS key;
  IF NOT v_event_found
     OR v_event.action IS DISTINCT FROM 'merchant.feature_settings.create'
     OR v_event.actor_user_id IS DISTINCT FROM v_actor_id
     OR v_event.resource_type IS DISTINCT FROM 'merchant_feature_settings'
     OR v_event.resource_id IS DISTINCT FROM v_primary_settings_id::text
     OR v_event.changed_fields IS DISTINCT FROM ARRAY['settings_snapshot']::text[]
     OR v_event.before_values IS NOT NULL
     OR v_after_value_keys IS DISTINCT FROM ARRAY['credentials', 'settings']::text[]
     OR v_event.metadata ->> 'operation' IS DISTINCT FROM 'insert'
     OR v_event.after_values -> 'settings' ->> 'paystack_enabled' IS DISTINCT FROM 'true'
     OR v_event.after_values -> 'settings' ->> 'korapay_enabled' IS DISTINCT FROM 'false'
     OR COALESCE((v_event.after_values -> 'settings' ->> 'credit_direct_min_amount')::numeric, -1)
        IS DISTINCT FROM 10000 THEN
    RAISE EXCEPTION 'merchant creation must emit one safe feature settings snapshot';
  END IF;
END;
$test$;
