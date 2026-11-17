/**
 * Zoho Campaigns tokens must never be stored in merchant_feature_settings.custom_settings:
 * that jsonb column is readable by every active staff member of the store. The refresh
 * token lives in merchant_zoho_campaign_credentials and is reached only through the
 * get/set_merchant_zoho_refresh_token functions. A database CHECK rejects token keys.
 */
const ZOHO_CUSTOM_SETTING_KEYS = ['zohoCampaigns', 'zoho_campaigns'] as const;
const ZOHO_REFRESH_TOKEN_KEYS = ['refreshToken', 'refresh_token'] as const;
const ZOHO_SECRET_KEYS = [
  'accessToken',
  'access_token',
  'clientSecret',
  'client_secret',
  ...ZOHO_REFRESH_TOKEN_KEYS,
] as const;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface ExtractedZohoSecrets<T> {
  /** custom_settings with every Zoho token key removed. */
  customSettings: T;
  /** Non-blank refresh token that was supplied, to be saved through the RPC. */
  refreshToken: string | undefined;
}

export function extractZohoCampaignSecrets<T>(
  customSettings: T
): ExtractedZohoSecrets<T> {
  if (!isRecord(customSettings))
    return { customSettings, refreshToken: undefined };

  const cleaned: JsonRecord = { ...customSettings };
  let refreshToken: string | undefined;

  for (const settingsKey of ZOHO_CUSTOM_SETTING_KEYS) {
    const zoho = cleaned[settingsKey];
    if (!isRecord(zoho)) continue;

    for (const tokenKey of ZOHO_REFRESH_TOKEN_KEYS) {
      const value = zoho[tokenKey];
      if (refreshToken === undefined && typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) refreshToken = trimmed;
      }
    }

    const withoutSecrets = { ...zoho };
    for (const secretKey of ZOHO_SECRET_KEYS) delete withoutSecrets[secretKey];
    cleaned[settingsKey] = withoutSecrets;
  }

  return { customSettings: cleaned as T, refreshToken };
}
