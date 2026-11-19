-- Public merchant snapshot assertions.

DO $assertions$
DECLARE
  v_merchant record;
  v_unpublished_merchant record;
  v_no_settings_merchant record;
  v_long_slug_product record;
  v_simple record;
  v_variant record;
  v_redirect record;
  v_blank_redirect record;
  v_hidden_category record;
  v_large_variant record;
  v_missing record;
  v_enrichment record;
  v_missing_enrichment record;
  v_oversized_enrichment record;
  v_public_feature_setting_keys constant text[] := ARRAY[
    'about_page_enabled',
    'agentic_checkout_enabled',
    'auto_blog_enabled',
    'blog_enabled',
    'blog_discover_image_validation_enabled',
    'checkout_collect_phone',
    'checkout_require_account',
    'checkout_show_order_notes',
    'chatgpt_pixel_id',
    'contact_page_enabled',
    'credpal_enabled',
    'credit_direct_enabled',
    'credit_direct_max_amount',
    'credit_direct_min_amount',
    'custom_settings',
    'customer_device_savings_auto_debit_enabled',
    'customer_device_savings_break_fee_enabled',
    'customer_device_savings_enabled',
    'discount_codes_enabled',
    'faq_page_enabled',
    'facebook_pixel_id',
    'free_shipping_threshold',
    'google_analytics_id',
    'google_place_id',
    'google_reviews_enabled',
    'guest_checkout_enabled',
    'juicyway_enabled',
    'klump_enabled',
    'klump_max_amount',
    'klump_min_amount',
    'korapay_enabled',
    'loyalty_enabled',
    'low_stock_threshold',
    'order_tracking_enabled',
    'pay_on_delivery_enabled',
    'paystack_enabled',
    'preferred_international_gateway',
    'preferred_local_gateway',
    'privacy_page_enabled',
    'repairs_catalog_enabled',
    'reviews_enabled',
    'rewards_page_enabled',
    'shipping_insurance_enabled',
    'shipping_insurance_min_order_value',
    'shipping_insurance_opt_in_default',
    'shipping_providers',
    'show_recent_purchases',
    'show_stock_levels',
    'snapchat_pixel_id',
    'terms_page_enabled',
    'tiktok_pixel_id',
    'twitter_event_ids',
    'twitter_pixel_id',
    'vtu_airtime_enabled',
    'vtu_checkout_addon_amounts',
    'vtu_checkout_addon_enabled',
    'vtu_data_enabled',
    'vtu_electricity_enabled',
    'vtu_enabled',
    'vtu_loyalty_reward_enabled',
    'vtu_tv_enabled',
    'wallet_order_auto_debit_enabled',
    'wallet_paystack_dva_enabled',
    'wishlist_enabled'
  ]::text[];
BEGIN
  SELECT
    snapshot.resolution_status,
    snapshot.merchant_data,
    snapshot.custom_domain,
    snapshot.feature_settings
  INTO v_merchant
  FROM public.resolve_storefront_public_snapshot_v2(
    'SNAPSHOT-TEST.USEBACI.COM'
  ) AS snapshot;

  IF v_merchant.resolution_status IS DISTINCT FROM 'found'
    OR v_merchant.merchant_data->>'id' IS DISTINCT FROM
      '4d19ab10-0000-4000-8000-000000000001'
    OR (v_merchant.feature_settings->>'blog_enabled')::boolean IS DISTINCT FROM true
    OR v_merchant.feature_settings->'custom_settings'->>'google_merchant_id'
      IS DISTINCT FROM 'public-merchant-id'
    OR v_merchant.feature_settings->'custom_settings' ? 'draft_secret'
    OR v_merchant.merchant_data ? 'paystack_subaccount_code'
    OR v_merchant.merchant_data ? 'plan_tier'
    OR v_merchant.merchant_data ? 'plan_expires_at'
    OR v_merchant.merchant_data ? 'premium_features'
    OR (v_merchant.merchant_data->>'paystack_subaccount_configured')::boolean
      IS DISTINCT FROM true
    OR (v_merchant.merchant_data->>'price_negotiation_enabled')::boolean
      IS DISTINCT FROM true
    OR v_merchant.feature_settings ? 'paystack_subaccount_configured'
    OR v_merchant.feature_settings ? 'price_negotiation_enabled'
  THEN
    RAISE EXCEPTION 'public merchant snapshot did not resolve normalized domain';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(
      v_merchant.feature_settings
    ) AS returned_setting(key)
    WHERE NOT (returned_setting.key = ANY (v_public_feature_setting_keys))
  )
  THEN
    RAISE EXCEPTION 'public merchant snapshot exposed a non-allowlisted setting';
  END IF;

  SELECT
    snapshot.resolution_status,
    snapshot.merchant_data,
    snapshot.custom_domain,
    snapshot.feature_settings
  INTO v_unpublished_merchant
  FROM public.resolve_storefront_public_snapshot_v2(
    'storefront-unpublished-snapshot-test'
  ) AS snapshot;

  IF v_unpublished_merchant.resolution_status IS DISTINCT FROM 'found'
    OR v_unpublished_merchant.merchant_data->>'id' IS DISTINCT FROM
      '4d19ab10-0000-4000-8000-000000000012'
    OR v_unpublished_merchant.merchant_data->>'business_name' IS DISTINCT FROM
      'Unpublished Snapshot Test'
    OR v_unpublished_merchant.merchant_data->>'slug' IS DISTINCT FROM
      'storefront-unpublished-snapshot-test'
    OR (v_unpublished_merchant.merchant_data->>'is_published')::boolean
      IS DISTINCT FROM false
    OR v_unpublished_merchant.merchant_data IS DISTINCT FROM
      pg_catalog.jsonb_build_object(
        'id', '4d19ab10-0000-4000-8000-000000000012',
        'business_name', 'Unpublished Snapshot Test',
        'slug', 'storefront-unpublished-snapshot-test',
        'is_published', false
      )
    OR v_unpublished_merchant.merchant_data ? 'paystack_subaccount_code'
    OR v_unpublished_merchant.merchant_data ? 'plan_tier'
    OR v_unpublished_merchant.merchant_data ? 'premium_features'
    OR v_unpublished_merchant.merchant_data ? 'published_config'
    OR v_unpublished_merchant.merchant_data ? 'pages'
    OR v_unpublished_merchant.custom_domain IS NOT NULL
    OR v_unpublished_merchant.feature_settings IS NOT NULL
  THEN
    RAISE EXCEPTION
      'unpublished merchant snapshot exposed draft, payment, plan, or feature data';
  END IF;

  SELECT
    snapshot.resolution_status,
    snapshot.merchant_data,
    snapshot.feature_settings
  INTO v_no_settings_merchant
  FROM public.resolve_storefront_public_snapshot_v2(
    'storefront-nosettings-snapshot-test'
  ) AS snapshot;

  IF v_no_settings_merchant.resolution_status IS DISTINCT FROM 'found'
    OR v_no_settings_merchant.merchant_data->>'id' IS DISTINCT FROM
      '4d19ab10-0000-4000-8000-000000000018'
    -- No merchant_feature_settings row: feature_settings must stay NULL so
    -- the app normalizer applies its public defaults instead of treating a
    -- partial object as authoritative.
    OR v_no_settings_merchant.feature_settings IS NOT NULL
    -- Derived capability hints must still be present on merchant_data.
    OR (v_no_settings_merchant.merchant_data->>'paystack_subaccount_configured')::boolean
      IS DISTINCT FROM false
    OR (v_no_settings_merchant.merchant_data->>'price_negotiation_enabled')::boolean
      IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION
      'missing feature-settings row was not preserved as NULL with derived hints';
  END IF;
END;
$assertions$;
