import 'server-only';

import { SNAPCHAT_ADS_API_ROOT } from './constants';
import {
  decimal,
  integer,
  isIsoDate,
  isoTimestamp,
  isTimezone,
  microToDecimal,
  nested,
  nextSnapchatAdsDate,
  objectArray,
  record,
  type SnapchatRecord,
  snapchatAdsLocalDate,
  snapchatAdsLocalMidnight,
} from './provider-utils';
import { requestSnapchatAdsJson, SnapchatAdsProviderError } from './request';

export {
  snapchatAdsLocalDate,
  snapchatAdsLocalMidnight,
} from './provider-utils';
export { SnapchatAdsProviderError } from './request';
export interface SnapchatAdsAccount {
  accountId: string;
  currencyCode: string;
  label: string;
  organizationId: string;
  timezoneName: string;
}
export interface SnapchatAdsDailyReport {
  accountId: string;
  clicks: string;
  conversions: string;
  currencyCode: string;
  impressions: string;
  spendAmountDecimal: string;
  spendDate: string;
  spendMicros: string;
  sourceEndTime: string;
  sourceStartTime: string;
  conversionDataProcessedEndTime: string | null;
  finalizedDataEndTime: string | null;
  timezoneName: string;
}
function accountFrom(
  value: SnapchatRecord,
  organizationId: string
): SnapchatAdsAccount | null {
  const account = nested(value, 'ad_account');
  const id = account.id;
  const label = account.name;
  const currency = account.currency;
  const timezone = account.timezone;
  const status =
    typeof account.status === 'string' ? account.status.toUpperCase() : '';
  if (
    typeof id !== 'string' ||
    !id ||
    typeof label !== 'string' ||
    !label ||
    typeof currency !== 'string' ||
    !/^[A-Z]{3}$/.test(currency) ||
    typeof timezone !== 'string' ||
    !isTimezone(timezone) ||
    status !== 'ACTIVE'
  )
    return null;
  return {
    accountId: id,
    currencyCode: currency,
    label,
    organizationId,
    timezoneName: timezone,
  };
}
export async function listSnapchatAdsAccounts(
  input: { accessToken: string },
  fetchImpl: typeof fetch = fetch
): Promise<SnapchatAdsAccount[]> {
  const url = new URL(`${SNAPCHAT_ADS_API_ROOT}/me/organizations`);
  url.searchParams.set('with_ad_accounts', 'true');
  const payload = await requestSnapchatAdsJson(
    url,
    { headers: { Authorization: `Bearer ${input.accessToken}` } },
    'SNAPCHAT_ADS_ACCOUNT_DISCOVERY_FAILED',
    fetchImpl
  );
  const root = record(payload);
  const organizations = objectArray(root?.organizations ?? root?.data);
  if (
    !root ||
    (!organizations.length && !Array.isArray(root.organizations ?? root.data))
  )
    throw new SnapchatAdsProviderError(
      'SNAPCHAT_ADS_ACCOUNT_DISCOVERY_INVALID'
    );
  const accounts = organizations.flatMap((entry) => {
    const organization = nested(entry, 'organization');
    const organizationId = organization.id;
    if (typeof organizationId !== 'string' || !organizationId) return [];
    return objectArray(
      organization.ad_accounts ?? organization.adaccounts
    ).flatMap((item) => {
      const account = accountFrom(item, organizationId);
      return account ? [account] : [];
    });
  });
  return [
    ...new Map(
      accounts.map((account) => [account.accountId, account])
    ).values(),
  ];
}
function statsList(payload: unknown): {
  metadata: SnapchatRecord | null;
  recognized: boolean;
  rows: SnapchatRecord[];
} {
  const root = record(payload);
  if (!root) return { metadata: null, recognized: false, rows: [] };
  const nestedData = record(root.data);
  const candidates = [
    root.timeseries_stats,
    root.timeseries,
    nestedData?.timeseries_stats,
    nestedData?.timeseries,
  ];
  for (const candidate of candidates) {
    if (candidate !== undefined) {
      if (!Array.isArray(candidate))
        return { metadata: null, recognized: false, rows: [] };
      const rows: SnapchatRecord[] = [];
      let metadata: SnapchatRecord | null = null;
      let recognized = true;
      for (const entry of candidate) {
        const wrapper = record(entry);
        const timeseriesStat = record(wrapper?.timeseries_stat);
        if (timeseriesStat) {
          metadata ??= timeseriesStat;
          if (!Array.isArray(timeseriesStat.timeseries)) {
            recognized = false;
            continue;
          }
          const timeseries = objectArray(timeseriesStat.timeseries);
          if (timeseries.length !== timeseriesStat.timeseries.length)
            recognized = false;
          rows.push(...timeseries);
          continue;
        }
        // Keep accepting the legacy flat shape while preferring the
        // documented timeseries_stats[].timeseries_stat.timeseries wrapper.
        if (
          wrapper &&
          ('stats' in wrapper ||
            'start_time' in wrapper ||
            'end_time' in wrapper)
        )
          rows.push(wrapper);
        else recognized = false;
      }
      return {
        metadata,
        recognized,
        rows,
      };
    }
  }
  return { metadata: null, recognized: false, rows: [] };
}
function parseReports(
  payload: unknown,
  input: { accountId: string; currencyCode: string; timezoneName: string }
): SnapchatAdsDailyReport[] {
  const stats = statsList(payload);
  if (!stats.recognized)
    throw new SnapchatAdsProviderError('SNAPCHAT_ADS_REPORT_RESPONSE_INVALID');
  const rows = stats.rows;
  const root = record(payload);
  const finalizedDataEndTime = isoTimestamp(
    stats.metadata?.finalized_data_end_time ?? root?.finalized_data_end_time
  );
  const conversionDataProcessedEndTime = isoTimestamp(
    stats.metadata?.conversion_data_processed_end_time ??
      root?.conversion_data_processed_end_time
  );
  const parsed = rows.flatMap((row) => {
    const stats = record(row.stats);
    const start = row.start_time;
    const end = row.end_time;
    const micros = integer(stats?.spend);
    const impressions = integer(stats?.impressions);
    const swipes = integer(stats?.swipes);
    const purchases = decimal(stats?.conversion_purchases);
    if (
      typeof start !== 'string' ||
      typeof end !== 'string' ||
      !micros ||
      !impressions ||
      !swipes ||
      !purchases
    )
      return [];
    const timestamp = Date.parse(start);
    if (!Number.isFinite(timestamp) || !Number.isFinite(Date.parse(end)))
      return [];
    return [
      {
        accountId: input.accountId,
        clicks: swipes,
        conversions: purchases,
        currencyCode: input.currencyCode,
        impressions,
        spendAmountDecimal: microToDecimal(micros),
        spendDate: snapchatAdsLocalDate(timestamp, input.timezoneName),
        spendMicros: micros,
        sourceEndTime: end,
        sourceStartTime: start,
        conversionDataProcessedEndTime,
        finalizedDataEndTime,
        timezoneName: input.timezoneName,
      },
    ];
  });
  if (rows.length !== parsed.length)
    throw new SnapchatAdsProviderError('SNAPCHAT_ADS_REPORT_ROWS_INVALID');
  return parsed;
}
export async function fetchSnapchatAdsDailyReport(
  input: {
    accessToken: string;
    accountId: string;
    currencyCode: string;
    endDate: string;
    startDate: string;
    timezoneName: string;
  },
  fetchImpl: typeof fetch = fetch
): Promise<SnapchatAdsDailyReport[]> {
  if (
    !input.accountId ||
    !isIsoDate(input.startDate) ||
    !isIsoDate(input.endDate) ||
    input.startDate > input.endDate ||
    !isTimezone(input.timezoneName)
  )
    throw new SnapchatAdsProviderError('SNAPCHAT_ADS_REPORT_INPUT_INVALID');
  const url = new URL(
    `${SNAPCHAT_ADS_API_ROOT}/adaccounts/${encodeURIComponent(input.accountId)}/stats`
  );
  url.searchParams.set(
    'end_time',
    snapchatAdsLocalMidnight(
      nextSnapchatAdsDate(input.endDate),
      input.timezoneName
    )
  );
  url.searchParams.set(
    'fields',
    'impressions,spend,swipes,conversion_purchases'
  );
  url.searchParams.set('granularity', 'DAY');
  url.searchParams.set('omit_empty', 'false');
  url.searchParams.set(
    'start_time',
    snapchatAdsLocalMidnight(input.startDate, input.timezoneName)
  );
  url.searchParams.set('action_report_time', 'conversion');
  url.searchParams.set('swipe_up_attribution_window', '28_DAY');
  url.searchParams.set('view_attribution_window', '1_DAY');
  const payload = await requestSnapchatAdsJson(
    url,
    { headers: { Authorization: `Bearer ${input.accessToken}` } },
    'SNAPCHAT_ADS_REPORT_FAILED',
    fetchImpl
  );
  const root = record(payload);
  const reportRunId = root?.report_run_id;
  if (typeof reportRunId === 'string' && reportRunId)
    throw new SnapchatAdsProviderError('SNAPCHAT_ADS_ASYNC_REPORT_UNSUPPORTED');
  return parseReports(payload, input);
}
