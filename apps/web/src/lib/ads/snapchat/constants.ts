import 'server-only';

export const SNAPCHAT_ADS_PROVIDER = 'snapchat_ads' as const;
export const SNAPCHAT_ADS_API_ROOT = 'https://adsapi.snapchat.com/v1' as const;
export const SNAPCHAT_ADS_AUTHORIZE_URL =
  'https://accounts.snapchat.com/login/oauth2/authorize' as const;
export const SNAPCHAT_ADS_TOKEN_URL =
  'https://accounts.snapchat.com/login/oauth2/access_token' as const;
export const SNAPCHAT_ADS_SCOPE = 'snapchat-marketing-api' as const;
export const SNAPCHAT_ADS_STATE_COOKIE =
  'baci_snapchat_ads_oauth_state' as const;
export const SNAPCHAT_ADS_OAUTH_COOKIE_MAX_AGE = 10 * 60;
export const SNAPCHAT_ADS_TRAILING_SYNC_DAYS = 30;
export const SNAPCHAT_ADS_REQUIRED_SCOPES = [SNAPCHAT_ADS_SCOPE] as const;
