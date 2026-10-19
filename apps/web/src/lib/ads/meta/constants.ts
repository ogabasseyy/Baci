import 'server-only';

export const META_ADS_PROVIDER = 'meta_ads' as const;
export const META_ADS_GRAPH_VERSION = 'v25.0' as const;
export const META_ADS_SCOPE = 'ads_read' as const;
export const META_ADS_STATE_COOKIE = 'baci_meta_ads_oauth_state' as const;
export const META_ADS_OAUTH_COOKIE_MAX_AGE = 10 * 60;
export const META_ADS_CONVERSION_ACTION_ALLOWLIST_VERSION =
  'meta_ads_purchase_v2' as const;
export const META_ADS_CONVERSION_ACTION_PRIORITY = [
  'offsite_conversion.fb_pixel_purchase',
  'omni_purchase',
  'purchase',
] as const;
export const META_ADS_CONVERSION_ACTION_TYPES = new Set(
  META_ADS_CONVERSION_ACTION_PRIORITY
);
