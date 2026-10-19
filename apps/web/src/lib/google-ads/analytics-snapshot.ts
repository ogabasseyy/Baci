import { deriveWindowLastSyncedAt } from '@/lib/analytics/reporting-freshness';

export interface GoogleAdsAnalyticsConnection {
  last_synced_at: string | null;
  last_synced_end_date?: string | null;
  last_synced_start_date?: string | null;
  provider_customer_id: string | null;
  status: string;
}

export interface GoogleAdsAnalyticsSpendRow {
  clicks: number | string | null;
  conversions: number | string | null;
  currency_code: string;
  fetched_at: string;
  impressions: number | string | null;
  provider_customer_id: string;
  spend_date: string;
  spend_micros: number | string;
}

function nonNegativeNumber(value: number | string | null): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function nonNegativeMicros(value: number | string): string {
  const parsed = String(value);
  return /^\d+$/.test(parsed) ? parsed : '0';
}

export interface GoogleAdsAnalyticsSnapshot {
  connected: boolean;
  connectionStatus: 'connected' | 'disconnected' | 'error';
  currencyCode?: string;
  customerId: string | null;
  dataStatus: 'error' | 'ready';
  endDate?: string;
  daily?: Array<{
    clicks: number;
    conversions: number;
    currencyCode: string;
    date: string;
    fetchedAt: string;
    impressions: number;
    spend: number;
    spendMicros: string;
  }>;
  lastSyncedAt: string | null;
  needsAccountSelection: boolean;
  error?: string;
  isStale: boolean;
  spend?: number;
  spendMicros?: string;
  startDate?: string;
}

interface BuildGoogleAdsAnalyticsSnapshotOptions {
  connectionReadFailed?: boolean;
  endDate?: string;
  now?: Date;
  spendReadFailed?: boolean;
  startDate?: string;
}

const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

function completedWindowCoversRequest(
  connection: GoogleAdsAnalyticsConnection,
  startDate: string | undefined,
  endDate: string | undefined
): boolean {
  if (!startDate && !endDate) return true;

  const completedStartDate = connection.last_synced_start_date;
  const completedEndDate = connection.last_synced_end_date;
  const hasCompletionMarker =
    completedStartDate !== undefined || completedEndDate !== undefined;

  // Connections created before range markers were introduced can still have
  // row-level freshness evidence. Keep that legacy path intact; once a marker
  // exists, never project rows from a window that it does not fully cover.
  if (!hasCompletionMarker) return true;
  if (!completedStartDate || !completedEndDate) return false;
  return (
    (!startDate || completedStartDate <= startDate) &&
    (!endDate || completedEndDate >= endDate)
  );
}

export function buildGoogleAdsAnalyticsSnapshot(
  connection: GoogleAdsAnalyticsConnection | null,
  rows: GoogleAdsAnalyticsSpendRow[],
  {
    connectionReadFailed = false,
    endDate,
    now = new Date(),
    spendReadFailed = false,
    startDate,
  }: BuildGoogleAdsAnalyticsSnapshotOptions = {}
): GoogleAdsAnalyticsSnapshot | undefined {
  if (connectionReadFailed) {
    return {
      connected: false,
      connectionStatus: 'error',
      customerId: null,
      dataStatus: 'error',
      endDate,
      error: 'Google Ads reporting is temporarily unavailable.',
      isStale: false,
      lastSyncedAt: null,
      needsAccountSelection: false,
      startDate,
    };
  }

  if (!connection) return undefined;
  const connected = connection.status === 'active';
  const connectionStatus =
    connection.status === 'error'
      ? 'error'
      : connected
        ? 'connected'
        : 'disconnected';
  const selectedCustomerId = connected ? connection.provider_customer_id : null;
  const lastSyncedAt = connection.last_synced_at;
  const requestedWindowCovered = completedWindowCoversRequest(
    connection,
    startDate,
    endDate
  );
  const selectedRows =
    selectedCustomerId && lastSyncedAt && requestedWindowCovered
      ? rows.filter(
          (row) =>
            row.provider_customer_id === selectedCustomerId &&
            (!startDate || row.spend_date >= startDate) &&
            (!endDate || row.spend_date <= endDate)
        )
      : [];
  const windowLastSyncedAt =
    startDate || endDate
      ? deriveWindowLastSyncedAt(
          selectedRows,
          connection.last_synced_start_date !== null &&
            connection.last_synced_start_date !== undefined &&
            connection.last_synced_end_date !== null &&
            connection.last_synced_end_date !== undefined &&
            requestedWindowCovered
            ? lastSyncedAt
            : null
        )
      : lastSyncedAt;
  const daily = selectedRows.map((row) => {
    const spendMicros = nonNegativeMicros(row.spend_micros);
    return {
      clicks: nonNegativeNumber(row.clicks),
      conversions: nonNegativeNumber(row.conversions),
      currencyCode: row.currency_code,
      date: row.spend_date,
      fetchedAt: row.fetched_at,
      impressions: nonNegativeNumber(row.impressions),
      spend: Number(spendMicros) / 1_000_000,
      spendMicros,
    };
  });
  const isStale =
    connected &&
    windowLastSyncedAt !== null &&
    now.getTime() - Date.parse(windowLastSyncedAt) > STALE_AFTER_MS;
  const dataStatus = spendReadFailed ? 'error' : 'ready';
  const error =
    dataStatus === 'error'
      ? 'Google Ads reporting is temporarily unavailable.'
      : connectionStatus === 'error'
        ? 'This connection needs to be reauthorized.'
        : undefined;
  if (daily.length === 0) {
    return {
      connected,
      connectionStatus,
      customerId: connection.provider_customer_id,
      dataStatus,
      endDate,
      error,
      isStale,
      lastSyncedAt: windowLastSyncedAt,
      needsAccountSelection: connected && !connection.provider_customer_id,
      startDate,
    };
  }

  let spendMicros = 0n;
  for (const row of daily) spendMicros += BigInt(row.spendMicros);
  return {
    connected,
    connectionStatus,
    currencyCode: daily[0]?.currencyCode,
    customerId: connection.provider_customer_id,
    dataStatus,
    daily,
    endDate,
    error,
    isStale,
    lastSyncedAt: windowLastSyncedAt,
    needsAccountSelection: connected && !connection.provider_customer_id,
    spend: Number(spendMicros) / 1_000_000,
    spendMicros: spendMicros.toString(),
    startDate,
  };
}
