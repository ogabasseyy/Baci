-- Make merchants.plan_tier the sole source of truth for the derived public
-- price_negotiation_enabled hint on the storefront snapshot.
--
-- The previous definition (20260723000009_public_snapshot_paypal_flags.sql)
-- carried a hardcoded legacy premium-slug fallback for the NULL-plan_tier
-- case: when a merchant row had no plan_tier, the function fell back to
-- matching the merchant's slug against a hardcoded allowlist of stores that
-- predated the plan column. That fallback is now removed, and an unrecognized
-- or absent tier fails closed.
--
-- This is behaviour-preserving: production has zero merchants with a NULL
-- plan_tier, so no row ever reaches the fallback branch today. To make that
-- permanent rather than incidental, this migration also backfills any residual
-- NULLs to 'free', re-asserts the 'free' column default, and adds NOT NULL to
-- merchants.plan_tier. With the invariant enforced at the schema level the
-- slug fallback can never be needed again, so both the SQL and the mirroring
-- app-layer helper (apps/web/src/lib/feature-flags.ts) can rely on the plan
-- tier alone.
--
-- The function body is otherwise byte-identical to
-- 20260723000009_public_snapshot_paypal_flags.sql: the feature-settings
-- allowlist, the published/unpublished projections, the derived
-- paystack_subaccount_configured hint, the grants, and the comment are
-- unchanged. Raw plan fields still never cross the anonymous boundary.

UPDATE public.merchants
   SET plan_tier = 'free'
 WHERE plan_tier IS NULL;

ALTER TABLE public.merchants
  ALTER COLUMN plan_tier SET DEFAULT 'free';

ALTER TABLE public.merchants
  ALTER COLUMN plan_tier SET NOT NULL;

CREATE OR REPLACE FUNCTION public.resolve_storefront_public_snapshot_v2(
  p_identifier text
)
RETURNS TABLE (
  resolution_status text,
  merchant_data jsonb,
  custom_domain text,
  feature_settings jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
ROWS 1
AS $$
  WITH resolved AS MATERIALIZED (
    SELECT
      merchant_row.merchant_data,
      merchant_row.custom_domain,
      -- Preserve the broad resolver's NULL when the merchant has no
      -- merchant_feature_settings row. The storefront normalizer applies its
      -- public defaults only when feature_settings is null, so a non-null
      -- partial object here would silently skip defaults such as
      -- korapay_enabled and guest_checkout_enabled.
      CASE WHEN merchant_row.feature_settings IS NULL THEN NULL::jsonb
      ELSE (
        COALESCE(
          (
            SELECT pg_catalog.jsonb_object_agg(
              public_feature_setting.key,
              public_feature_setting.value
            )
            FROM pg_catalog.jsonb_each(
              merchant_row.feature_settings
            ) AS public_feature_setting(key, value)
            -- This second allowlist is intentional defense in depth. The
            -- service-role resolver is allowlisted today, but its future
            -- additions must not cross this anonymous wrapper automatically.
            WHERE public_feature_setting.key = ANY (ARRAY[
              'about_page_enabled',
              'agentic_checkout_enabled',
              'auto_blog_enabled',
              'blog_enabled',
              'blog_discover_image_validation_enabled',
              'checkout_collect_phone',
              'checkout_require_account',
              'checkout_show_order_notes',
              'contact_page_enabled',
              'credpal_enabled',
              'credit_direct_enabled',
              'credit_direct_max_amount',
              'credit_direct_min_amount',
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
              'customer_device_savings_enabled',
              'customer_device_savings_auto_debit_enabled',
              'customer_device_savings_break_fee_enabled',
              'wishlist_enabled'
            ]::text[])
          ),
          '{}'::jsonb
        )
        || pg_catalog.jsonb_build_object(
          'custom_settings',
          -- Keep this explicit key list synchronized with the app-layer
          -- pickPublicCustomSettings allowlist whenever a public key is added.
          pg_catalog.jsonb_strip_nulls(
            pg_catalog.jsonb_build_object(
              'google_merchant_id',
                merchant_row.feature_settings->'custom_settings'->'google_merchant_id',
              'google_store_widget_enabled',
                merchant_row.feature_settings->'custom_settings'->'google_store_widget_enabled',
              'paypal_enabled',
                merchant_row.feature_settings->'custom_settings'->'paypal_enabled',
              'paypal_mode',
                merchant_row.feature_settings->'custom_settings'->'paypal_mode'
            )
          )
        )
      ) END AS feature_settings,
      -- Derived public capability hints ride on the published merchant
      -- projection (not feature_settings) so they stay available when the
      -- merchant has no settings row. Raw payment/plan fields never cross
      -- the anonymous boundary.
      NULLIF(
        pg_catalog.btrim(
          merchant_row.merchant_data->>'paystack_subaccount_code'
        ),
        ''
      ) IS NOT NULL AS paystack_subaccount_configured,
      -- Mirrors hasPriceNegotiationEntitlement() in
      -- apps/web/src/lib/feature-flags.ts. plan_tier is NOT NULL, so an
      -- unrecognized value fails closed instead of matching a slug allowlist.
      COALESCE(
        merchant_row.merchant_data->>'plan_tier' IN (
          'pro',
          'business',
          'enterprise'
        ),
        false
      ) AS price_negotiation_enabled,
      COALESCE(
        (merchant_row.merchant_data->>'is_published')::boolean,
        false
      ) AS is_published
    FROM public.resolve_storefront_cached_merchant(
      pg_catalog.lower(pg_catalog.btrim(p_identifier))
    ) AS merchant_row
  ),
  public_projection AS MATERIALIZED (
    SELECT
      CASE
        WHEN resolved.is_published THEN pg_catalog.jsonb_build_object(
          'id', resolved.merchant_data->'id',
          'business_name', resolved.merchant_data->'business_name',
          'site_title', resolved.merchant_data->'site_title',
          'site_tagline', resolved.merchant_data->'site_tagline',
          'site_description', resolved.merchant_data->'site_description',
          'business_type', resolved.merchant_data->'business_type',
          'logo_url', resolved.merchant_data->'logo_url',
          'phone', resolved.merchant_data->'phone',
          'email', resolved.merchant_data->'email',
          'support_email', resolved.merchant_data->'support_email',
          'support_phone', resolved.merchant_data->'support_phone',
          'social_media', resolved.merchant_data->'social_media',
          'brand_colors', resolved.merchant_data->'brand_colors',
          'slug', resolved.merchant_data->'slug',
          'business_address', resolved.merchant_data->'business_address',
          'legal_entity_name', resolved.merchant_data->'legal_entity_name',
          'registered_address', resolved.merchant_data->'registered_address',
          'tax_identification_number',
            resolved.merchant_data->'tax_identification_number',
          'trust_profile', resolved.merchant_data->'trust_profile',
          'payout_currency', resolved.merchant_data->'payout_currency',
          'is_published', resolved.merchant_data->'is_published',
          'template_id', resolved.merchant_data->'template_id',
          'country', resolved.merchant_data->'country',
          'hero_slides', resolved.merchant_data->'hero_slides',
          'mobile_hero_slides', resolved.merchant_data->'mobile_hero_slides',
          'favicon_svg_url', resolved.merchant_data->'favicon_svg_url',
          'favicon_png_32_url', resolved.merchant_data->'favicon_png_32_url',
          'favicon_apple_touch_url',
            resolved.merchant_data->'favicon_apple_touch_url',
          'vat_registration_status',
            resolved.merchant_data->'vat_registration_status',
          'vat_rate', resolved.merchant_data->'vat_rate',
          'published_config', resolved.merchant_data->'published_config',
          'pages', resolved.merchant_data->'pages',
          'about_page', resolved.merchant_data->'about_page',
          'faq_items', resolved.merchant_data->'faq_items',
          'updated_at', resolved.merchant_data->'updated_at',
          'paystack_subaccount_configured',
            resolved.paystack_subaccount_configured,
          'price_negotiation_enabled',
            resolved.price_negotiation_enabled
        )
        ELSE pg_catalog.jsonb_build_object(
          'id', resolved.merchant_data->'id',
          'business_name', resolved.merchant_data->'business_name',
          'slug', resolved.merchant_data->'slug',
          'is_published', false
        )
      END AS merchant_data,
      CASE WHEN resolved.is_published THEN resolved.custom_domain
        ELSE NULL::text
      END AS custom_domain,
      CASE WHEN resolved.is_published THEN resolved.feature_settings
        ELSE NULL::jsonb
      END AS feature_settings
    FROM resolved
  )
  SELECT
    'found'::text,
    public_projection.merchant_data,
    pg_catalog.lower(pg_catalog.btrim(public_projection.custom_domain)),
    public_projection.feature_settings
  FROM public_projection

  UNION ALL

  SELECT
    'not_found'::text,
    NULL::jsonb,
    NULL::text,
    NULL::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public_projection);
$$;

REVOKE ALL ON FUNCTION public.resolve_storefront_public_snapshot_v2(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_storefront_public_snapshot_v2(text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.resolve_storefront_public_snapshot_v2(text) IS
  'Bounded public merchant-shell snapshot with explicit found/not_found status and unpublished-store data minimization.';
