import type { MerchantData } from '@/hooks/use-merchant';
import type { CachedMerchant } from '@/lib/cached-data';

function normalizePlanTier(
  planTier: CachedMerchant['plan_tier']
): MerchantData['plan_tier'] {
  switch (planTier) {
    case 'free':
    case 'starter':
    case 'pro':
    case 'business':
    case 'enterprise':
      return planTier;
    default:
      return undefined;
  }
}

function normalizePremiumFeatures(
  premiumFeatures: CachedMerchant['premium_features']
): MerchantData['premium_features'] {
  return Array.isArray(premiumFeatures) &&
    premiumFeatures.every((feature) => typeof feature === 'string')
    ? premiumFeatures
    : undefined;
}

const PUBLIC_FEATURE_SETTING_KEYS = [
  'about_page_enabled',
  'auto_blog_enabled',
  'blog_enabled',
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
  'free_shipping_threshold',
  'google_analytics_id',
  'google_place_id',
  'google_reviews_enabled',
  'google_site_verification',
  'google_store_widget_enabled',
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
  'wallet_paystack_dva_enabled',
  'preferred_international_gateway',
  'preferred_local_gateway',
  'privacy_page_enabled',
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
  'vtu_enabled',
  'vtu_loyalty_reward_enabled',
  'vtu_tv_enabled',
  'wishlist_enabled',
] as const;

const PUBLIC_CUSTOM_SETTING_KEYS = [
  'google_merchant_id',
  'google_store_widget_enabled',
] as const;

function isPublicFeatureSettingValue(value: unknown) {
  return (
    value == null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    (Array.isArray(value) &&
      value.every(
        (entry) =>
          typeof entry === 'boolean' ||
          typeof entry === 'number' ||
          typeof entry === 'string'
      ))
  );
}

function pickPublicCustomSettings(
  customSettings: unknown
): Record<string, unknown> | undefined {
  if (
    !customSettings ||
    typeof customSettings !== 'object' ||
    Array.isArray(customSettings)
  ) {
    return undefined;
  }

  const source = customSettings as Record<string, unknown>;
  const picked: Record<string, unknown> = {};

  for (const key of PUBLIC_CUSTOM_SETTING_KEYS) {
    if (!Object.hasOwn(source, key)) {
      continue;
    }

    const value = source[key];

    if (value !== undefined && isPublicFeatureSettingValue(value)) {
      picked[key] = value;
    }
  }

  return Object.keys(picked).length > 0 ? picked : undefined;
}

function pickPublicFeatureSettings(
  featureSettings: CachedMerchant['feature_settings']
): MerchantData['feature_settings'] {
  if (!featureSettings) {
    return undefined;
  }

  const source = featureSettings as Record<string, unknown>;
  const picked: Record<string, unknown> = {};

  // Public storefront state is serialized into the RSC payload. Keep this as an
  // allowlist so merchant payment/API secrets cannot leak through future
  // feature_settings additions.
  for (const key of PUBLIC_FEATURE_SETTING_KEYS) {
    if (!Object.hasOwn(source, key)) {
      continue;
    }

    const value = source[key];

    if (value !== undefined && isPublicFeatureSettingValue(value)) {
      picked[key] = value;
    }
  }

  const publicCustomSettings = pickPublicCustomSettings(source.custom_settings);

  if (publicCustomSettings) {
    picked.custom_settings = publicCustomSettings;
  }

  return Object.keys(picked).length > 0
    ? (picked as MerchantData['feature_settings'])
    : undefined;
}

export function toTemplateMerchantData(merchant: CachedMerchant): MerchantData {
  return {
    id: merchant.id,
    // Public storefront rendering does not expose the owner user id.
    user_id: '',
    business_name: merchant.business_name,
    business_type: merchant.business_type,
    email: merchant.email,
    phone: merchant.phone,
    logo_url: merchant.logo_url,
    brand_colors: merchant.brand_colors,
    country: merchant.country,
    // Thread payout_currency so storefront currency resolution (useCurrency →
    // resolveMerchantCurrencyConfig) respects the merchant's selling currency,
    // not just their country. cached-data already selects it.
    payout_currency: merchant.payout_currency,
    pages: merchant.pages,
    paystack_subaccount_code: merchant.paystack_subaccount_code,
    // Derived snapshot capability hints — presentation only; private
    // payment/order paths stay authoritative.
    paystack_subaccount_configured: merchant.paystack_subaccount_configured,
    price_negotiation_enabled: merchant.price_negotiation_enabled,
    shared_cart_enabled: merchant.shared_cart_enabled,
    shared_cart_accounts_enabled: merchant.shared_cart_accounts_enabled,
    shared_cart_realtime_enabled: merchant.shared_cart_realtime_enabled,
    slug: merchant.slug,
    custom_domain: merchant.custom_domain,
    favicon_svg_url: merchant.favicon_svg_url,
    favicon_png_32_url: merchant.favicon_png_32_url,
    favicon_apple_touch_url: merchant.favicon_apple_touch_url,
    social_media: merchant.social_media,
    support_email: merchant.support_email ?? undefined,
    support_phone: merchant.support_phone ?? undefined,
    business_address: merchant.business_address,
    legal_entity_name: merchant.legal_entity_name,
    registered_address: merchant.registered_address,
    tax_identification_number: merchant.tax_identification_number,
    trust_profile: merchant.trust_profile,
    is_published: merchant.is_published,
    feature_settings: pickPublicFeatureSettings(merchant.feature_settings),
    template_id: merchant.template_id,
    plan_tier: normalizePlanTier(merchant.plan_tier),
    premium_features: normalizePremiumFeatures(merchant.premium_features),
    published_config: merchant.published_config,
    vat_registration_status: merchant.vat_registration_status,
    vat_rate: merchant.vat_rate,
    hero_slides: merchant.hero_slides,
    mobile_hero_slides: merchant.mobile_hero_slides,
    about_page: merchant.about_page,
    faq_items: merchant.faq_items,
  };
}
