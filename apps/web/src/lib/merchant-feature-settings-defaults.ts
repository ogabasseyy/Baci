const DEFAULT_MERCHANT_FEATURE_SETTINGS = {
  loyalty_enabled: false,
  reviews_enabled: true,
  wishlist_enabled: true,
  order_tracking_enabled: true,
  discount_codes_enabled: true,
  guest_checkout_enabled: true,
  agentic_checkout_enabled: true,
  paystack_enabled: true,
  // Korapay is OFF by default (opt-in for ALL currencies). This matches the DB
  // column default (merchant_feature_settings.korapay_enabled DEFAULT false) and
  // the strict checkout gate (isKorapayCheckoutAvailable === true). Do NOT set
  // this true: a stored `true` would offer Korapay at NGN checkout alongside
  // Paystack, routing funds through Baci's own Korapay account. Non-NGN corridors
  // are enabled deliberately per merchant, not via this default.
  korapay_enabled: false,
  pay_on_delivery_enabled: false,
  credit_direct_enabled: false,
  credit_direct_public_key: null,
  credit_direct_min_amount: 10000,
  credit_direct_max_amount: 500000,
  credpal_enabled: false,
  klump_enabled: false,
  klump_min_amount: 10000,
  klump_max_amount: 1000000,
  preferred_local_gateway: 'paystack' as const,
  preferred_international_gateway: 'korapay' as const,
  // Carrier rates are opt-in per merchant. Stores can still use their own
  // configured delivery rates and pickup options with no carrier enabled.
  shipping_providers: [],
  free_shipping_threshold: null,
  shipping_markup_percentage: 0,
  checkout_collect_phone: true,
  checkout_require_account: false,
  checkout_show_order_notes: true,
  about_page_enabled: true,
  contact_page_enabled: true,
  faq_page_enabled: true,
  privacy_page_enabled: true,
  terms_page_enabled: true,
  rewards_page_enabled: false,
  show_recent_purchases: false,
  show_stock_levels: true,
  low_stock_threshold: 10,
  google_analytics_id: null,
  ga4_api_secret: null,
  facebook_pixel_id: null,
  facebook_capi_token: null,
  tiktok_pixel_id: null,
  tiktok_access_token: null,
  snapchat_pixel_id: null,
  snapchat_capi_token: null,
  twitter_pixel_id: null,
  auto_generate_schema: true,
  custom_robots_txt: null,
  email_notifications_enabled: true,
  sms_notifications_enabled: false,
  blog_enabled: false,
  auto_blog_enabled: false,
  blog_discover_image_validation_enabled: false,
  google_reviews_enabled: false,
  google_place_id: null,
  shipping_insurance_enabled: false,
  shipping_insurance_min_order_value: 0,
  shipping_insurance_opt_in_default: false,
  juicyway_enabled: false,
  wallet_order_auto_debit_enabled: false,
  wallet_paystack_dva_enabled: false,
  customer_device_savings_enabled: false,
  customer_device_savings_auto_debit_enabled: false,
  customer_device_savings_break_fee_enabled: false,
  vtu_enabled: false,
  vtu_airtime_enabled: true,
  vtu_data_enabled: true,
  vtu_electricity_enabled: true,
  vtu_tv_enabled: true,
  vtu_betting_enabled: true,
  vtu_checkout_addon_enabled: false,
  vtu_checkout_addon_amounts: [100, 200, 500, 1000],
  vtu_loyalty_reward_enabled: false,
  vtu_merchant_commission_rate: 50,
  vtu_customer_cashback_enabled: false,
  vtu_customer_cashback_rate: 50,
  repairs_catalog_enabled: false,
  custom_settings: {},
};

const PUBLIC_DEFAULT_FEATURE_SETTING_KEYS = [
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
  'custom_settings',
  'discount_codes_enabled',
  'faq_page_enabled',
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
  'wishlist_enabled',
] as const;

type DefaultFeatureSettings = typeof DEFAULT_MERCHANT_FEATURE_SETTINGS;
type DefaultFeatureSettingsWithMerchant = DefaultFeatureSettings & {
  merchant_id: string;
};
type PublicDefaultFeatureSettingKey =
  (typeof PUBLIC_DEFAULT_FEATURE_SETTING_KEYS)[number];
type PublicDefaultFeatureSettings = Pick<
  DefaultFeatureSettings,
  PublicDefaultFeatureSettingKey
> & {
  merchant_id: string;
};

/** Returns a defensive deep copy of a default value. */
function cloneDefaultValue<T>(value: T): T {
  if (value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => cloneDefaultValue(entry)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        cloneDefaultValue(entryValue),
      ])
    ) as T;
  }

  return value;
}

function buildDefaultMerchantFeatureSettingFields(): DefaultFeatureSettings {
  const settings: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(
    DEFAULT_MERCHANT_FEATURE_SETTINGS
  )) {
    settings[key] = cloneDefaultValue(value);
  }

  return settings as DefaultFeatureSettings;
}

function buildDefaultMerchantFeatureSettings(
  merchantId: string
): DefaultFeatureSettingsWithMerchant {
  return {
    merchant_id: merchantId,
    ...buildDefaultMerchantFeatureSettingFields(),
  };
}

function buildPublicDefaultMerchantFeatureSettings(
  merchantId: string
): PublicDefaultFeatureSettings {
  const settings: Record<string, unknown> = { merchant_id: merchantId };

  for (const key of PUBLIC_DEFAULT_FEATURE_SETTING_KEYS) {
    settings[key] = cloneDefaultValue(DEFAULT_MERCHANT_FEATURE_SETTINGS[key]);
  }

  return settings as PublicDefaultFeatureSettings;
}

export const merchantFeatureSettingsDefaults = {
  buildDefault: buildDefaultMerchantFeatureSettings,
  buildFields: buildDefaultMerchantFeatureSettingFields,
  buildPublicDefault: buildPublicDefaultMerchantFeatureSettings,
  defaults: DEFAULT_MERCHANT_FEATURE_SETTINGS,
  publicKeys: PUBLIC_DEFAULT_FEATURE_SETTING_KEYS,
};
