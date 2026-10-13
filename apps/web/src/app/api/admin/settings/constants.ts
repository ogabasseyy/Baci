export const PLATFORM_SETTINGS_SECRET_FIELDS = [
  'ga4_api_secret',
  'facebook_capi_token',
  'tiktok_access_token',
  'snapchat_capi_token',
] as const;

export const PLATFORM_ANALYTICS_IDENTIFIER_MAX_LENGTH = 50;
export const PLATFORM_GA4_SECRET_MAX_LENGTH = 100;

export type PlatformSettingsSecretField =
  (typeof PLATFORM_SETTINGS_SECRET_FIELDS)[number];

export const PLATFORM_SETTINGS_SAFE_FIELDS = [
  'id',
  'google_analytics_id',
  'facebook_pixel_id',
  'tiktok_pixel_id',
  'snapchat_pixel_id',
  'twitter_pixel_id',
  'platform_fee_percentage',
  'platform_fee_flat',
  'payment_processor_fee_percentage',
  'payment_processor_fee_flat',
  'platform_name',
  'platform_logo_url',
  'support_email',
  'support_phone',
  'enable_merchant_signups',
  'enable_custom_domains',
  'enable_analytics_export',
  'maintenance_mode',
  'maintenance_message',
  'created_at',
  'updated_at',
] as const;
