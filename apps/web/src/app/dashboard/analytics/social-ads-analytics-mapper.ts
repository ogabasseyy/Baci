import type {
  SocialAdsProviderReporting,
  SocialAdsReportingData,
} from '@/components/analytics/social-ads-reporting-card';

interface JsonRecord {
  [key: string]: unknown;
}

const PROVIDERS = ['meta_ads', 'tiktok_ads', 'snapchat_ads'] as const;
const DECIMAL = /^\d+(?:\.\d+)?$/;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asDecimal(value: unknown): string | null {
  const candidate = asString(value);
  return candidate && DECIMAL.test(candidate) ? candidate : null;
}

function mapSpendByCurrency(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = asRecord(item);
    const currencyCode = asString(row?.currencyCode)?.toUpperCase();
    const spendAmountDecimal = asDecimal(row?.spendAmountDecimal);
    return currencyCode && /^[A-Z]{3}$/.test(currencyCode) && spendAmountDecimal
      ? [{ currencyCode, spendAmountDecimal }]
      : [];
  });
}

function mapProvider(value: unknown): SocialAdsProviderReporting | null {
  const provider = asRecord(value);
  if (!provider || !PROVIDERS.includes(provider.provider as never)) return null;
  const metrics = asRecord(provider.metrics);
  const connectionStatus = provider.connectionStatus;
  const freshness = provider.freshness;

  return {
    accountName: asString(provider.accountName),
    accountTimezone: asString(provider.accountTimezone),
    clicksLabel: asString(provider.clicksLabel) ?? 'Clicks',
    connectionStatus:
      connectionStatus === 'connected' ||
      connectionStatus === 'disconnected' ||
      connectionStatus === 'error'
        ? connectionStatus
        : 'disconnected',
    conversionsLabel:
      asString(provider.conversionsLabel) ?? 'Provider-attributed conversions',
    dataStatus: provider.dataStatus === 'error' ? 'error' : 'ready',
    displayName: asString(provider.displayName) ?? 'Ad platform',
    error: asString(provider.error),
    freshness:
      freshness === 'fresh' ||
      freshness === 'stale' ||
      freshness === 'never_synced' ||
      freshness === 'not_applicable'
        ? freshness
        : 'not_applicable',
    isStale: provider.isStale === true,
    lastSyncedAt: asString(provider.lastSyncedAt),
    metrics: metrics
      ? {
          clicks: asDecimal(metrics.clicks) ?? '0',
          conversions: asDecimal(metrics.conversions) ?? '0',
          endDate: asString(metrics.endDate),
          impressions: asDecimal(metrics.impressions) ?? '0',
          reach: asDecimal(metrics.reach),
          spendByCurrency: mapSpendByCurrency(metrics.spendByCurrency),
          startDate: asString(metrics.startDate),
        }
      : null,
    needsAccountSelection: provider.needsAccountSelection === true,
    provider: provider.provider as SocialAdsProviderReporting['provider'],
  };
}

export function mapSocialAdsReporting(
  value: unknown
): SocialAdsReportingData | undefined {
  const socialAds = asRecord(value);
  if (!socialAds) return undefined;
  const providers = Array.isArray(socialAds.providers)
    ? socialAds.providers.flatMap((provider) => {
        const mapped = mapProvider(provider);
        return mapped ? [mapped] : [];
      })
    : [];

  return {
    attributionNotice:
      asString(socialAds.attributionNotice) ??
      'Provider-attributed conversions are separate from Baci paid orders and revenue.',
    mixedCurrencies: socialAds.mixedCurrencies === true,
    providers,
    spendByCurrency: mapSpendByCurrency(socialAds.spendByCurrency),
  };
}
