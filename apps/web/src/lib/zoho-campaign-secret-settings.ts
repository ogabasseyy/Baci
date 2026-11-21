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

export type ZohoCustomSettings = Record<string, unknown> | undefined;

export interface ExtractedZohoSecrets {
  /** custom_settings with every Zoho token key removed. */
  customSettings: ZohoCustomSettings;
  /**
   * `string`: a new refresh token to save. `null`: the key was sent blank or null, which
   * clears the stored token. `undefined`: the request did not mention the token, so the
   * stored one is left alone.
   */
  refreshToken: string | null | undefined;
}

export function extractZohoCampaignSecrets(
  customSettings: ZohoCustomSettings
): ExtractedZohoSecrets {
  if (!isRecord(customSettings))
    return { customSettings, refreshToken: undefined };

  const cleaned: JsonRecord = { ...customSettings };
  let refreshToken: string | null | undefined;
  let sawBlankToken = false;

  for (const settingsKey of ZOHO_CUSTOM_SETTING_KEYS) {
    const zoho = cleaned[settingsKey];
    if (!isRecord(zoho)) continue;

    for (const tokenKey of ZOHO_REFRESH_TOKEN_KEYS) {
      if (!(tokenKey in zoho)) continue;
      const value = zoho[tokenKey];
      // Only a string or an explicit null is a statement about the token; any other
      // value (a number, an object) is ignored so it cannot clear the stored one.
      if (value !== null && typeof value !== 'string') continue;
      const trimmed = typeof value === 'string' ? value.trim() : '';
      if (trimmed && typeof refreshToken !== 'string') refreshToken = trimmed;
      else if (!trimmed) sawBlankToken = true;
    }

    const withoutSecrets = { ...zoho };
    for (const secretKey of ZOHO_SECRET_KEYS) delete withoutSecrets[secretKey];
    cleaned[settingsKey] = withoutSecrets;
  }

  if (refreshToken === undefined && sawBlankToken) refreshToken = null;

  return { customSettings: cleaned, refreshToken };
}
