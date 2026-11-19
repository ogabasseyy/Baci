import type { SupabaseClient } from '@supabase/supabase-js';
import type { ZohoCampaignsRuntimeConfig } from '@/env';
import { resolveZohoCampaignsDataCenterEndpoint } from '@/lib/zoho-campaigns-data-centers';

export type MerchantZohoEmailBrand = {
  brandColor?: string;
  brandName: string;
};

type ParsedMerchantZohoSettings = {
  accountsServerUrl?: string;
  apiRootUrl?: string;
  autoSend?: boolean;
  enabled: boolean;
  fromEmail?: string;
  fromName?: string;
  listKey?: string;
  refreshToken?: string;
  reviewListKey?: string;
  topicId?: string;
};

type ResolvedMerchantZohoCampaignConfig =
  | {
      reason: string;
      status: 'skipped';
    }
  | {
      brand: MerchantZohoEmailBrand;
      config: ZohoCampaignsRuntimeConfig;
      reviewListKey?: string;
      status: 'configured';
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function getStringField(
  source: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = normalizeString(source[key]);
    if (value) return value;
  }
  return undefined;
}

function getBooleanField(
  source: Record<string, unknown>,
  ...keys: string[]
): boolean | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
      if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    }
  }
  return undefined;
}

function getZohoDataCenterEndpointFields(source: Record<string, unknown>) {
  const apiEndpoint =
    resolveZohoCampaignsDataCenterEndpoint(source.apiRootUrl) ??
    resolveZohoCampaignsDataCenterEndpoint(source.api_root_url) ??
    resolveZohoCampaignsDataCenterEndpoint(source.apiDomain) ??
    resolveZohoCampaignsDataCenterEndpoint(source.api_domain);
  const accountsEndpoint =
    resolveZohoCampaignsDataCenterEndpoint(source.accountsServerUrl) ??
    resolveZohoCampaignsDataCenterEndpoint(source.accounts_server_url) ??
    resolveZohoCampaignsDataCenterEndpoint(source.accountsDomain) ??
    resolveZohoCampaignsDataCenterEndpoint(source.accounts_domain);

  return {
    accountsServerUrl:
      accountsEndpoint?.accountsServerUrl ?? apiEndpoint?.accountsServerUrl,
    apiRootUrl: apiEndpoint?.apiRootUrl ?? accountsEndpoint?.apiRootUrl,
  };
}

function getZohoSettingsRecord(
  customSettings: unknown
): Record<string, unknown> | null {
  if (!isRecord(customSettings)) return null;

  const camelCaseSettings = customSettings.zohoCampaigns;
  if (isRecord(camelCaseSettings)) return camelCaseSettings;

  const snakeCaseSettings = customSettings.zoho_campaigns;
  if (isRecord(snakeCaseSettings)) return snakeCaseSettings;

  return null;
}

export function parseMerchantZohoCampaignSettings(
  customSettings: unknown
): ParsedMerchantZohoSettings | null {
  const settings = getZohoSettingsRecord(customSettings);
  if (!settings) return null;

  const dataCenterEndpoint = getZohoDataCenterEndpointFields(settings);

  return {
    accountsServerUrl: dataCenterEndpoint.accountsServerUrl,
    apiRootUrl: dataCenterEndpoint.apiRootUrl,
    autoSend: getBooleanField(settings, 'autoSend', 'auto_send'),
    enabled: getBooleanField(settings, 'enabled') === true,
    fromEmail: getStringField(settings, 'fromEmail', 'from_email'),
    fromName: getStringField(settings, 'fromName', 'from_name'),
    listKey: getStringField(settings, 'listKey', 'list_key'),
    refreshToken: getStringField(settings, 'refreshToken', 'refresh_token'),
    reviewListKey: getStringField(settings, 'reviewListKey', 'review_list_key'),
    topicId: getStringField(settings, 'topicId', 'topic_id'),
  };
}

export function normalizeZohoBrandColor(value: unknown): string | undefined {
  const color = normalizeString(value);
  if (!color) return undefined;

  if (/^#[0-9a-f]{6}$/i.test(color)) return color;

  const shortHex = /^#([0-9a-f]{3})$/i.exec(color);
  if (!shortHex) return undefined;

  return `#${shortHex[1]
    .split('')
    .map((segment) => `${segment}${segment}`)
    .join('')}`;
}

function getPrimaryBrandColor(brandColors: unknown): string | undefined {
  if (!isRecord(brandColors)) return undefined;
  return (
    normalizeZohoBrandColor(brandColors.primary) ??
    normalizeZohoBrandColor(brandColors.accent)
  );
}

export async function getMerchantZohoEmailBrand(
  supabase: SupabaseClient,
  merchantId: string
): Promise<MerchantZohoEmailBrand> {
  const { data: merchant, error } = await supabase
    .from('merchants')
    .select('business_name, brand_colors')
    .eq('id', merchantId)
    .maybeSingle();

  if (error) {
    console.error('Failed to load merchant brand for Zoho email content', {
      error: error.message,
      merchantId,
    });
    throw error;
  }

  return {
    brandColor: getPrimaryBrandColor(merchant?.brand_colors),
    brandName: normalizeString(merchant?.business_name) ?? 'Store Updates',
  };
}

export async function resolveMerchantZohoCampaignConfig({
  config,
  merchantId,
  supabase,
}: {
  config: ZohoCampaignsRuntimeConfig;
  merchantId: string;
  supabase: SupabaseClient;
}): Promise<ResolvedMerchantZohoCampaignConfig> {
  const { data: featureSettings, error } = await supabase
    .from('merchant_feature_settings')
    .select('custom_settings')
    .eq('merchant_id', merchantId)
    .maybeSingle();

  if (error) {
    console.error('Failed to load merchant Zoho Campaigns settings', {
      error: error.message,
      merchantId,
    });
    throw error;
  }

  const settings = parseMerchantZohoCampaignSettings(
    featureSettings?.custom_settings
  );

  if (!settings?.enabled) {
    return {
      reason: 'Zoho Campaigns is not enabled for this merchant',
      status: 'skipped',
    };
  }

  const { data: storedRefreshToken, error: tokenError } = await supabase.rpc(
    'get_merchant_zoho_refresh_token',
    { p_merchant_id: merchantId }
  );
  if (tokenError) {
    console.error('Failed to load merchant Zoho Campaigns token', {
      error: tokenError.message,
      merchantId,
    });
    throw tokenError;
  }
  const refreshToken = normalizeString(storedRefreshToken);

  const missingSettings = [
    ['refreshToken', refreshToken],
    ['listKey', settings.listKey],
    ['fromEmail', settings.fromEmail],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missingSettings.length > 0) {
    return {
      reason: `Missing Zoho Campaigns merchant settings: ${missingSettings.join(', ')}`,
      status: 'skipped',
    };
  }

  const brand = await getMerchantZohoEmailBrand(supabase, merchantId);

  return {
    brand,
    reviewListKey: settings.reviewListKey,
    config: {
      ...config,
      accountsServerUrl: settings.accountsServerUrl ?? config.accountsServerUrl,
      apiRootUrl: settings.apiRootUrl ?? config.apiRootUrl,
      autoSend: settings.autoSend ?? config.autoSend,
      fromEmail: settings.fromEmail,
      fromName: settings.fromName ?? brand.brandName,
      listKey: settings.listKey,
      refreshToken,
      topicId: settings.topicId ?? config.topicId,
    },
    status: 'configured',
  };
}
