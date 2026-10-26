import { INTEGRATION_SECRET_FIELDS } from './integration-secret-settings';

type JsonRecord = Record<string, unknown>;

const ZOHO_CAMPAIGNS_CUSTOM_SETTING_KEYS = [
  'zohoCampaigns',
  'zoho_campaigns',
] as const;

const ZOHO_CAMPAIGNS_SECRET_KEYS = [
  'accessToken',
  'access_token',
  'clientSecret',
  'client_secret',
  'refreshToken',
  'refresh_token',
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redactZohoCampaignSettingsRecord(settings: JsonRecord): JsonRecord {
  const redacted = { ...settings };
  for (const key of ZOHO_CAMPAIGNS_SECRET_KEYS) {
    delete redacted[key];
  }
  return redacted;
}

export function redactMerchantFeatureSettingsResponse<T>(settings: T): T {
  if (!isRecord(settings)) return settings;
  const safe: JsonRecord = { ...settings };
  for (const key of INTEGRATION_SECRET_FIELDS) {
    if (!(key in safe)) continue;
    safe[`${key}_configured`] =
      typeof safe[key] === 'string' && safe[key].trim().length > 0;
    safe[key] = null;
  }
  if (!isRecord(settings.custom_settings)) return safe as T;

  const redactedCustomSettings = { ...settings.custom_settings };
  let didRedact = false;

  for (const key of ZOHO_CAMPAIGNS_CUSTOM_SETTING_KEYS) {
    const zohoSettings = redactedCustomSettings[key];
    if (!isRecord(zohoSettings)) continue;

    redactedCustomSettings[key] =
      redactZohoCampaignSettingsRecord(zohoSettings);
    didRedact = true;
  }

  if (!didRedact) return safe as T;

  return {
    ...safe,
    custom_settings: redactedCustomSettings,
  } as T;
}

function preserveZohoSettingsFields(
  incomingSettings: JsonRecord,
  existingSettings: JsonRecord
): JsonRecord {
  return {
    ...existingSettings,
    ...incomingSettings,
  };
}

export function preserveZohoCampaignSecretCustomSettings(
  incomingCustomSettings: unknown,
  existingCustomSettings: unknown
): JsonRecord {
  const incoming = isRecord(incomingCustomSettings)
    ? { ...incomingCustomSettings }
    : {};
  if (!isRecord(existingCustomSettings)) return incoming;

  for (const key of ZOHO_CAMPAIGNS_CUSTOM_SETTING_KEYS) {
    const existingZohoSettings = existingCustomSettings[key];
    if (!isRecord(existingZohoSettings)) continue;

    const incomingZohoSettings = incoming[key];
    if (!isRecord(incomingZohoSettings)) {
      if (!(key in incoming)) incoming[key] = existingZohoSettings;
      continue;
    }

    incoming[key] = preserveZohoSettingsFields(
      incomingZohoSettings,
      existingZohoSettings
    );
  }

  return incoming;
}

/** Strip integration credentials before dashboard context crosses into React/JSON. */
export function redactMerchantIntegrationContext<T>(merchant: T): T {
  if (!isRecord(merchant)) return merchant;
  const safe: JsonRecord = redactMerchantFeatureSettingsResponse(merchant);
  if (isRecord(safe.feature_settings))
    safe.feature_settings = redactMerchantFeatureSettingsResponse(
      safe.feature_settings
    );
  return safe as T;
}
