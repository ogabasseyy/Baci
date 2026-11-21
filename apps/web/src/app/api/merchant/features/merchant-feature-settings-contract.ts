import { INTEGRATION_SECRET_FIELDS } from '@/lib/integration-secret-settings';
import { merchantFeatureSettingsDefaults } from '@/lib/merchant-feature-settings-defaults';

export interface MerchantFeatureSettings {
  id: string | null;
  merchant_id: string;
  loyalty_enabled: boolean;
  reviews_enabled: boolean;
  wishlist_enabled: boolean;
  order_tracking_enabled: boolean;
  discount_codes_enabled: boolean;
  guest_checkout_enabled: boolean;
  agentic_checkout_enabled: boolean;
  repairs_catalog_enabled: boolean;
  paystack_enabled: boolean;
  korapay_enabled: boolean;
  pay_on_delivery_enabled: boolean;
  credit_direct_enabled: boolean;
  credit_direct_public_key: string | null;
  credit_direct_min_amount: number;
  credit_direct_max_amount: number;
  credpal_enabled: boolean;
  klump_enabled: boolean;
  klump_min_amount: number;
  klump_max_amount: number;
  preferred_local_gateway: 'paystack' | 'korapay';
  preferred_international_gateway: 'paystack' | 'korapay';
  shipping_providers: string[];
  free_shipping_threshold: number | null;
  shipping_markup_percentage: number;
  checkout_collect_phone: boolean;
  checkout_require_account: boolean;
  checkout_show_order_notes: boolean;
  about_page_enabled: boolean;
  contact_page_enabled: boolean;
  faq_page_enabled: boolean;
  privacy_page_enabled: boolean;
  terms_page_enabled: boolean;
  rewards_page_enabled: boolean;
  show_recent_purchases: boolean;
  show_stock_levels: boolean;
  low_stock_threshold: number;
  google_analytics_id: string | null;
  ga4_api_secret: string | null;
  facebook_pixel_id: string | null;
  facebook_capi_token: string | null;
  tiktok_pixel_id: string | null;
  tiktok_access_token: string | null;
  snapchat_pixel_id: string | null;
  snapchat_capi_token: string | null;
  twitter_pixel_id: string | null;
  auto_generate_schema: boolean;
  custom_robots_txt: string | null;
  email_notifications_enabled: boolean;
  sms_notifications_enabled: boolean;
  blog_enabled: boolean;
  auto_blog_enabled: boolean;
  google_reviews_enabled: boolean;
  google_place_id: string | null;
  vtu_enabled: boolean;
  vtu_airtime_enabled: boolean;
  vtu_data_enabled: boolean;
  vtu_electricity_enabled: boolean;
  vtu_tv_enabled: boolean;
  vtu_betting_enabled: boolean;
  vtu_checkout_addon_enabled: boolean;
  vtu_checkout_addon_amounts: number[];
  vtu_loyalty_reward_enabled: boolean;
  vtu_merchant_commission_rate: number;
  vtu_customer_cashback_enabled: boolean;
  vtu_customer_cashback_rate: number;
  custom_settings: Record<string, unknown>;
  created_at: string | null;
  updated_at: string | null;
}

const merchantFeatureAllFields: readonly (keyof MerchantFeatureSettings)[] = [
  'id',
  'merchant_id',
  'loyalty_enabled',
  'reviews_enabled',
  'wishlist_enabled',
  'order_tracking_enabled',
  'discount_codes_enabled',
  'guest_checkout_enabled',
  'agentic_checkout_enabled',
  'repairs_catalog_enabled',
  'paystack_enabled',
  'korapay_enabled',
  'pay_on_delivery_enabled',
  'credit_direct_enabled',
  'credit_direct_public_key',
  'credit_direct_min_amount',
  'credit_direct_max_amount',
  'credpal_enabled',
  'klump_enabled',
  'klump_min_amount',
  'klump_max_amount',
  'preferred_local_gateway',
  'preferred_international_gateway',
  'shipping_providers',
  'free_shipping_threshold',
  'shipping_markup_percentage',
  'checkout_collect_phone',
  'checkout_require_account',
  'checkout_show_order_notes',
  'about_page_enabled',
  'contact_page_enabled',
  'faq_page_enabled',
  'privacy_page_enabled',
  'terms_page_enabled',
  'rewards_page_enabled',
  'show_recent_purchases',
  'show_stock_levels',
  'low_stock_threshold',
  'google_analytics_id',
  'ga4_api_secret',
  'facebook_pixel_id',
  'facebook_capi_token',
  'tiktok_pixel_id',
  'tiktok_access_token',
  'snapchat_pixel_id',
  'snapchat_capi_token',
  'twitter_pixel_id',
  'auto_generate_schema',
  'custom_robots_txt',
  'email_notifications_enabled',
  'sms_notifications_enabled',
  'blog_enabled',
  'auto_blog_enabled',
  'google_reviews_enabled',
  'google_place_id',
  'vtu_enabled',
  'vtu_airtime_enabled',
  'vtu_data_enabled',
  'vtu_electricity_enabled',
  'vtu_tv_enabled',
  'vtu_betting_enabled',
  'vtu_checkout_addon_enabled',
  'vtu_checkout_addon_amounts',
  'vtu_loyalty_reward_enabled',
  'vtu_merchant_commission_rate',
  'vtu_customer_cashback_enabled',
  'vtu_customer_cashback_rate',
  'custom_settings',
  'created_at',
  'updated_at',
];

/**
 * Columns the signed-in session may SELECT. The ad-platform secrets are not
 * granted to `authenticated` (audit R2), so they are never selected here; their
 * "configured" state comes from get_merchant_integration_secret_presence.
 */
export const merchantFeatureSelectFields: readonly (keyof MerchantFeatureSettings)[] =
  merchantFeatureAllFields.filter(
    (field) => !(INTEGRATION_SECRET_FIELDS as readonly string[]).includes(field)
  );

type _MerchantFeatureSelectFieldsExhaustive =
  Exclude<
    keyof MerchantFeatureSettings,
    (typeof merchantFeatureAllFields)[number]
  > extends never
    ? true
    : false;
const merchantFeatureSelectCompletenessCheck: _MerchantFeatureSelectFieldsExhaustive = true;
void merchantFeatureSelectCompletenessCheck;

type MerchantFeatureDefaultField = Exclude<
  keyof MerchantFeatureSettings,
  'id' | 'merchant_id' | 'created_at' | 'updated_at'
>;

export const defaultMerchantFeatureSettings =
  merchantFeatureSettingsDefaults.buildFields() as Record<
    MerchantFeatureDefaultField,
    unknown
  >;

function getDefaultFeatureSetting(field: MerchantFeatureDefaultField) {
  const value = defaultMerchantFeatureSettings[field];
  if (value === undefined) {
    throw new Error(`Missing default merchant feature setting: ${field}`);
  }
  return value;
}

export function buildReadOnlyDefaultFeatureSettings(
  merchantId: string
): MerchantFeatureSettings {
  const settings: Record<string, unknown> = {};
  for (const field of merchantFeatureSelectFields) {
    if (field === 'id' || field === 'created_at' || field === 'updated_at') {
      settings[field] = null;
    } else if (field === 'merchant_id') {
      settings[field] = merchantId;
    } else {
      settings[field] = getDefaultFeatureSetting(field);
    }
  }
  return settings as unknown as MerchantFeatureSettings;
}
