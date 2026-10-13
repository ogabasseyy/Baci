import { deriveWindowLastSyncedAt } from './reporting-freshness';

export const SOCIAL_ADS_REPORTING_PROVIDERS = [
  'meta_ads',
  'tiktok_ads',
  'snapchat_ads',
] as const;

export type SocialAdsReportingProvider =
  (typeof SOCIAL_ADS_REPORTING_PROVIDERS)[number];

interface SocialAdsConnectionRow {
  account_timezone: string | null;
  last_synced_at: string | null;
  last_synced_end_date?: string | null;
  last_synced_start_date?: string | null;
  provider: string;
  provider_account_label: string | null;
  provider_customer_id: string | null;
  status: string;
  token_expires_at?: string | null;
}

interface SocialAdsSpendRow {
  account_timezone: string | null;
  clicks: number | string | null;
  conversions: number | string | null;
  currency_code: string;
  fetched_at: string;
  impressions: number | string | null;
  provider: string;
  provider_customer_id: string;
  reach: number | string | null;
  spend_amount_decimal: number | string | null;
  spend_date: string;
}

interface BuildSocialAdsAnalyticsSnapshotOptions {
  connectionReadFailed?: boolean;
  connections: SocialAdsConnectionRow[];
  endDate: string;
  now?: Date;
  spendReadFailed?: boolean;
  spendRows: SocialAdsSpendRow[];
  startDate: string;
}

const PROVIDER_DETAILS = {
  meta_ads: {
    clicksLabel: 'Clicks',
    conversionsLabel: 'Meta-attributed conversions',
    displayName: 'Meta Ads',
  },
  snapchat_ads: {
    clicksLabel: 'Swipe Ups',
    conversionsLabel: 'Snapchat-attributed purchases',
    displayName: 'Snapchat Ads',
  },
  tiktok_ads: {
    clicksLabel: 'Clicks',
    conversionsLabel: 'TikTok-attributed conversions',
    displayName: 'TikTok Ads',
  },
} as const;

const NON_NEGATIVE_DECIMAL = /^\d+(?:\.\d+)?$/;
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

function decimalString(value: number | string | null): string {
  const normalized = String(value ?? '0');
  return NON_NEGATIVE_DECIMAL.test(normalized) ? normalized : '0';
}

function addDecimals(left: string, right: string): string {
  const [leftWhole = '0', leftFraction = ''] = left.split('.');
  const [rightWhole = '0', rightFraction = ''] = right.split('.');
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftInteger = BigInt(`${leftWhole}${leftFraction.padEnd(scale, '0')}`);
  const rightInteger = BigInt(
    `${rightWhole}${rightFraction.padEnd(scale, '0')}`
  );
  const total = (leftInteger + rightInteger)
    .toString()
    .padStart(scale + 1, '0');
  if (scale === 0) return total;
  const whole = total.slice(0, -scale);
  const fraction = total.slice(-scale).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function sumField(
  rows: SocialAdsSpendRow[],
  field: 'clicks' | 'conversions' | 'impressions' | 'reach'
): string {
  return rows.reduce(
    (total, row) => addDecimals(total, decimalString(row[field])),
    '0'
  );
}

function hasExpiredToken(
  tokenExpiresAt: string | null | undefined,
  now: Date
): boolean {
  if (!tokenExpiresAt) return false;
  const expiresAt = Date.parse(tokenExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}

function tokenExpiryRequiresReauthorization(
  provider: string | undefined,
  tokenExpiresAt: string | null | undefined,
  now: Date
): boolean {
  if (provider === 'snapchat_ads') return false;
  if (provider === 'meta_ads' && !tokenExpiresAt) return true;
  return hasExpiredToken(tokenExpiresAt, now);
}

function completedWindowCoversRequest(
  connection: SocialAdsConnectionRow | undefined,
  startDate: string,
  endDate: string
): boolean {
  const completedStartDate = connection?.last_synced_start_date;
  const completedEndDate = connection?.last_synced_end_date;
  const hasCompletionMarker =
    completedStartDate !== undefined || completedEndDate !== undefined;

  // Connections created before range markers were introduced can still have
  // row-level freshness evidence. Keep that legacy path intact; once a marker
  // exists, never project rows from a window that it does not fully cover.
  if (!hasCompletionMarker) return true;
  if (!completedStartDate || !completedEndDate) return false;
  return completedStartDate <= startDate && completedEndDate >= endDate;
}

function spendByCurrency(rows: SocialAdsSpendRow[]) {
  const totals = new Map<string, string>();
  for (const row of rows) {
    const currencyCode = row.currency_code.toUpperCase();
    if (!/^[A-Z]{3}$/.test(currencyCode)) continue;
    totals.set(
      currencyCode,
      addDecimals(
        totals.get(currencyCode) ?? '0',
        decimalString(row.spend_amount_decimal)
      )
    );
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currencyCode, spendAmountDecimal]) => ({
      currencyCode,
      spendAmountDecimal,
    }));
}

/**
 * Builds a credential-free reporting projection. Provider conversions remain
 * explicitly provider-attributed and are never combined with Baci order
 * revenue or used to manufacture cross-currency ROAS.
 */
export function buildSocialAdsAnalyticsSnapshot({
  connectionReadFailed = false,
  connections,
  endDate,
  now = new Date(),
  spendReadFailed = false,
  spendRows,
  startDate,
}: BuildSocialAdsAnalyticsSnapshotOptions) {
  const selectedSpendRows = spendRows.filter((row) => {
    const connection = connections.find(
      (candidate) => candidate.provider === row.provider
    );
    return (
      row.spend_date >= startDate &&
      row.spend_date <= endDate &&
      connection?.status === 'active' &&
      Boolean(connection.last_synced_at) &&
      !tokenExpiryRequiresReauthorization(
        connection.provider,
        connection.token_expires_at,
        now
      ) &&
      Boolean(connection.provider_customer_id) &&
      row.provider_customer_id === connection.provider_customer_id &&
      completedWindowCoversRequest(connection, startDate, endDate)
    );
  });
  const providers = SOCIAL_ADS_REPORTING_PROVIDERS.map((provider) => {
    const connection = connections.find((row) => row.provider === provider);
    const rows = selectedSpendRows.filter((row) => row.provider === provider);
    const tokenExpired = tokenExpiryRequiresReauthorization(
      connection?.provider,
      connection?.token_expires_at,
      now
    );
    const isConnected = connection?.status === 'active' && !tokenExpired;
    const needsAccountSelection =
      isConnected && !connection?.provider_customer_id;
    // A populated window derives its timestamp from row fetches. Empty
    // windows need a completion marker covering the requested range; an
    // unrelated connection-level marker must not make them appear fresh.
    const completedWindowMatches =
      Boolean(connection?.last_synced_start_date) &&
      Boolean(connection?.last_synced_end_date) &&
      completedWindowCoversRequest(connection, startDate, endDate);
    const windowLastSyncedAt = deriveWindowLastSyncedAt(
      rows,
      completedWindowMatches ? (connection?.last_synced_at ?? null) : null
    );
    const freshness = !isConnected
      ? 'not_applicable'
      : !windowLastSyncedAt
        ? 'never_synced'
        : now.getTime() - Date.parse(windowLastSyncedAt) > STALE_AFTER_MS
          ? 'stale'
          : 'fresh';
    const dataStatus =
      connectionReadFailed || spendReadFailed ? 'error' : 'ready';
    const connectionStatus = connectionReadFailed
      ? 'error'
      : connection?.status === 'error'
        ? 'error'
        : tokenExpired
          ? 'error'
          : isConnected
            ? 'connected'
            : 'disconnected';

    return {
      accountName: connection?.provider_account_label ?? null,
      accountTimezone:
        connection?.account_timezone ?? rows[0]?.account_timezone ?? null,
      clicksLabel: PROVIDER_DETAILS[provider].clicksLabel,
      connectionStatus,
      conversionsLabel: PROVIDER_DETAILS[provider].conversionsLabel,
      dataStatus,
      displayName: PROVIDER_DETAILS[provider].displayName,
      error:
        dataStatus === 'error'
          ? 'Reporting data is temporarily unavailable.'
          : connectionStatus === 'error'
            ? 'This connection needs to be reauthorized.'
            : null,
      freshness,
      isStale: freshness === 'stale',
      lastSyncedAt: windowLastSyncedAt,
      metrics:
        rows.length === 0
          ? null
          : {
              clicks: sumField(rows, 'clicks'),
              conversions: sumField(rows, 'conversions'),
              endDate,
              impressions: sumField(rows, 'impressions'),
              reach:
                startDate === endDate && rows.some((row) => row.reach !== null)
                  ? sumField(rows, 'reach')
                  : null,
              spendByCurrency: spendByCurrency(rows),
              startDate,
            },
      needsAccountSelection,
      provider,
    };
  });
  const allSpend = spendByCurrency(selectedSpendRows);

  return {
    attributionNotice:
      'Provider-attributed conversions are reporting signals and are separate from Baci paid orders and revenue.',
    mixedCurrencies: allSpend.length > 1,
    providers,
    spendByCurrency: allSpend,
  };
}
