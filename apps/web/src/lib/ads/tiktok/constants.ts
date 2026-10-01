import 'server-only';

export const TIKTOK_ADS_PROVIDER = 'tiktok_ads' as const;
export const TIKTOK_ADS_API_VERSION = 'v1.3' as const;
export const TIKTOK_ADS_API_ROOT = `https://business-api.tiktok.com/open_api/${TIKTOK_ADS_API_VERSION}`;
export const TIKTOK_ADS_STATE_COOKIE = 'baci_tiktok_ads_oauth_state' as const;
export const TIKTOK_ADS_OAUTH_COOKIE_MAX_AGE = 10 * 60;
export const TIKTOK_ADS_REQUIRED_SCOPES = ['44', '100'] as const;
export const TIKTOK_ADS_MAX_SYNC_DAYS = 30;
export const TIKTOK_ADS_LATENCY_LABEL =
  'regular_metrics_30m_to_2h; reach_offline_up_to_16h; daily_correction_12_utc' as const;
