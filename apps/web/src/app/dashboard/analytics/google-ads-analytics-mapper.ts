import type {
  GoogleAdsConnectionStatus,
  GoogleAdsReportingData,
  GoogleAdsReportingMetrics,
} from '@/components/analytics/google-ads-reporting-card';

interface JsonRecord {
  [key: string]: unknown;
}

function asRecord(value: unknown): JsonRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function asArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function asGoogleAdsConnectionStatus(
  value: unknown
): GoogleAdsConnectionStatus | undefined {
  if (
    value === 'connected' ||
    value === 'disconnected' ||
    value === 'error' ||
    value === 'syncing'
  ) {
    return value;
  }

  return undefined;
}

function asGoogleAdsDataStatus(value: unknown): 'error' | 'ready' | undefined {
  if (value === 'error' || value === 'ready') return value;
  return undefined;
}

function mapGoogleAdsMetricNumber(
  metrics: JsonRecord,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = asOptionalNumber(metrics[key]);
    if (value !== undefined) return value;
  }

  return undefined;
}

function sumGoogleAdsRows(rows: JsonRecord[], key: string): number | undefined {
  let total = 0;
  let hasValue = false;

  for (const row of rows) {
    const value = asOptionalNumber(row[key]);
    if (value === undefined) continue;
    total += value;
    hasValue = true;
  }

  return hasValue ? total : undefined;
}

function getGoogleAdsWindowBoundary(
  rows: JsonRecord[],
  boundary: 'endDate' | 'startDate'
): string | undefined {
  const dates = rows
    .map((row) => asOptionalString(row.date))
    .filter((date): date is string => date !== undefined)
    .sort();
  if (dates.length === 0) return undefined;
  return boundary === 'startDate' ? dates[0] : dates.at(-1);
}

export function mapGoogleAdsReporting(
  value: unknown
): GoogleAdsReportingData | undefined {
  const googleAds = asRecord(value);
  if (!googleAds) return undefined;

  const connection = asRecord(googleAds.connection);
  const metricsRecord = asRecord(googleAds.metrics) ?? googleAds;
  const rows = asArray(googleAds.rows ?? googleAds.daily);
  const clicks =
    mapGoogleAdsMetricNumber(metricsRecord, 'clicks') ??
    sumGoogleAdsRows(rows, 'clicks');
  const impressions =
    mapGoogleAdsMetricNumber(metricsRecord, 'impressions') ??
    sumGoogleAdsRows(rows, 'impressions');
  const spend =
    mapGoogleAdsMetricNumber(metricsRecord, 'spend', 'totalSpend') ??
    sumGoogleAdsRows(rows, 'spend');
  const metrics: GoogleAdsReportingMetrics = {
    clicks,
    conversions:
      mapGoogleAdsMetricNumber(
        metricsRecord,
        'conversions',
        'totalConversions'
      ) ?? sumGoogleAdsRows(rows, 'conversions'),
    cpc:
      mapGoogleAdsMetricNumber(metricsRecord, 'cpc') ??
      (spend !== undefined && clicks !== undefined && clicks > 0
        ? spend / clicks
        : undefined),
    ctr:
      mapGoogleAdsMetricNumber(metricsRecord, 'ctr') ??
      (clicks !== undefined && impressions !== undefined && impressions > 0
        ? (clicks / impressions) * 100
        : undefined),
    endDate:
      asOptionalString(metricsRecord.endDate ?? googleAds.endDate) ??
      getGoogleAdsWindowBoundary(rows, 'endDate'),
    impressions,
    spend,
    startDate:
      asOptionalString(metricsRecord.startDate ?? googleAds.startDate) ??
      getGoogleAdsWindowBoundary(rows, 'startDate'),
  };

  const hasMetrics = [
    metrics.clicks,
    metrics.conversions,
    metrics.cpc,
    metrics.ctr,
    metrics.impressions,
    metrics.spend,
  ].some((metric) => metric !== undefined);
  const dataStatus = asGoogleAdsDataStatus(
    googleAds.dataStatus ?? connection?.dataStatus
  );
  const status =
    dataStatus === 'error' ||
    typeof googleAds.error === 'string' ||
    typeof connection?.error === 'string'
      ? 'error'
      : (asGoogleAdsConnectionStatus(
          connection?.status ?? googleAds.connectionStatus ?? googleAds.status
        ) ??
        (connection?.connected === true || googleAds.connected === true
          ? 'connected'
          : connection?.connected === false || googleAds.connected === false
            ? 'disconnected'
            : hasMetrics
              ? 'connected'
              : undefined));

  return {
    accountName: asOptionalString(
      connection?.accountName ?? googleAds.accountName ?? googleAds.name
    ),
    connectionStatus: status,
    currency: asOptionalString(
      connection?.currency ?? googleAds.currency ?? googleAds.currencyCode
    ),
    dataStatus,
    error: asOptionalString(connection?.error ?? googleAds.error),
    isStale: googleAds.isStale === true,
    lastSyncedAt: asOptionalString(
      connection?.lastSyncedAt ??
        googleAds.lastSyncedAt ??
        googleAds.last_synced_at
    ),
    metrics: hasMetrics ? metrics : undefined,
    needsAccountSelection:
      googleAds.needsAccountSelection === true ||
      googleAds.requiresAccountSelection === true ||
      (googleAds.connected === true && googleAds.customerId === null),
  };
}
