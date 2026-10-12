import type { MerchantData } from '@/hooks/merchant';

export type IntegrationStatusState =
  | 'active'
  | 'feed_ready'
  | 'not_configured'
  | 'partial';

export interface IntegrationStatus {
  actionLabel: string;
  label: string;
  state: IntegrationStatusState;
}

type MerchantTextSettingKey =
  | 'facebook_capi_token'
  | 'facebook_pixel_id'
  | 'ga4_api_secret'
  | 'google_analytics_id'
  | 'snapchat_capi_token'
  | 'snapchat_pixel_id'
  | 'tiktok_access_token'
  | 'tiktok_pixel_id'
  | 'twitter_pixel_id';

const REQUIRED_SETTINGS_BY_INTEGRATION: Partial<
  Record<string, readonly MerchantTextSettingKey[]>
> = {
  facebook: ['facebook_pixel_id', 'facebook_capi_token'],
  'google-analytics': ['google_analytics_id', 'ga4_api_secret'],
  snapchat: ['snapchat_pixel_id', 'snapchat_capi_token'],
  tiktok: ['tiktok_pixel_id', 'tiktok_access_token'],
  twitter: ['twitter_pixel_id'],
};

const STATUS_COPY: Record<IntegrationStatusState, IntegrationStatus> = {
  active: {
    actionLabel: 'Manage',
    label: 'Active',
    state: 'active',
  },
  feed_ready: {
    actionLabel: 'Setup guide',
    label: 'Feed ready',
    state: 'feed_ready',
  },
  not_configured: {
    actionLabel: 'Configure',
    label: 'Not configured',
    state: 'not_configured',
  },
  partial: {
    actionLabel: 'Finish setup',
    label: 'Partial',
    state: 'partial',
  },
};

function isFilledText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function readMerchantSetting(
  merchant: MerchantData,
  key: MerchantTextSettingKey
) {
  const featureValue = merchant.feature_settings?.[key];
  if (isFilledText(featureValue)) {
    return featureValue.trim();
  }

  const merchantValue = merchant[key];
  return isFilledText(merchantValue) ? merchantValue.trim() : null;
}

function getRequiredSettingsStatus(
  merchant: MerchantData,
  requiredSettings: readonly MerchantTextSettingKey[]
) {
  const configuredCount = requiredSettings.filter((key) =>
    readMerchantSetting(merchant, key)
  ).length;

  if (configuredCount === requiredSettings.length) {
    return STATUS_COPY.active;
  }

  if (configuredCount > 0) {
    return STATUS_COPY.partial;
  }

  return STATUS_COPY.not_configured;
}

export function getIntegrationStatus(
  integrationId: string,
  merchant: MerchantData
): IntegrationStatus {
  if (integrationId === 'google-merchant') {
    return STATUS_COPY.feed_ready;
  }

  // Connector status lives behind the owners-only grants API, not merchant
  // feature settings, so the hub cannot resolve it here. The label stays
  // honest about access instead of claiming a connection state.
  if (integrationId === 'muse') {
    return { actionLabel: 'Open', label: 'Owners only', state: 'partial' };
  }

  const requiredSettings = REQUIRED_SETTINGS_BY_INTEGRATION[integrationId];
  if (!requiredSettings) {
    return STATUS_COPY.not_configured;
  }

  return getRequiredSettingsStatus(merchant, requiredSettings);
}
