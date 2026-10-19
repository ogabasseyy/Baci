import 'server-only';

import { TIKTOK_ADS_API_ROOT } from './constants';
import type { TikTokAdsDailyReport } from './provider-types';
import {
  createTikTokAdsRetryBudget,
  requestTikTokAdsJson,
  TikTokAdsProviderError,
} from './request';

const DECIMAL = /^\d+(?:\.\d+)?$/;
const INTEGER = /^\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PAGES = 20;

function record(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

function asInteger(value: unknown): string | null {
  return typeof value === 'string' && INTEGER.test(value) ? value : null;
}

function parseReportRows(
  payload: unknown,
  fallback: {
    accountId: string;
    currencyCode: string | null;
    timezoneName: string | null;
  }
): TikTokAdsDailyReport[] {
  const data = record(record(payload)?.data);
  const list = data?.list;
  if (!Array.isArray(list))
    throw new TikTokAdsProviderError('TIKTOK_ADS_REPORT_RESPONSE_INVALID');
  const parsedRows = list.flatMap((item) => {
    const row = record(item);
    if (!row) return [];
    const dimensions = record(row.dimensions);
    const metrics = record(row.metrics);
    const advertiserId = dimensions?.advertiser_id;
    const rawDate = dimensions?.stat_time_day;
    const date = typeof rawDate === 'string' ? rawDate.slice(0, 10) : '';
    const spend = metrics?.spend;
    const currency = metrics?.currency ?? fallback.currencyCode;
    const timezone =
      dimensions?.timezone ?? row.timezone ?? fallback.timezoneName;
    const impressions = asInteger(metrics?.impressions);
    const clicks = asInteger(metrics?.clicks);
    const conversions =
      typeof metrics?.conversion === 'string' &&
      DECIMAL.test(metrics.conversion)
        ? metrics.conversion
        : null;
    if (
      !ISO_DATE.test(date) ||
      typeof spend !== 'string' ||
      !DECIMAL.test(spend) ||
      typeof advertiserId !== 'string' ||
      advertiserId !== fallback.accountId ||
      typeof currency !== 'string' ||
      !/^[A-Z]{3}$/.test(currency) ||
      typeof timezone !== 'string' ||
      !timezone.trim() ||
      !impressions ||
      !clicks ||
      !conversions
    )
      return [];
    return [
      {
        accountId: fallback.accountId,
        clicks,
        conversions,
        currencyCode: currency,
        impressions,
        reach: asInteger(metrics?.reach),
        spendAmountDecimal: spend,
        spendDate: date,
        timezoneName: timezone,
      },
    ];
  });
  if (list.length > 0 && parsedRows.length !== list.length)
    throw new TikTokAdsProviderError('TIKTOK_ADS_REPORT_ROWS_INVALID');
  return parsedRows;
}

function nextPage(payload: unknown, hasRows: boolean): number | null {
  const pageInfo = record(record(record(payload)?.data)?.page_info);
  if (!pageInfo) {
    if (hasRows)
      throw new TikTokAdsProviderError('TIKTOK_ADS_REPORT_PAGING_INVALID');
    return null;
  }

  const current =
    typeof pageInfo.page === 'number'
      ? pageInfo.page
      : typeof pageInfo.page === 'string' && INTEGER.test(pageInfo.page)
        ? Number(pageInfo.page)
        : Number.NaN;
  const total =
    typeof pageInfo.total_page === 'number'
      ? pageInfo.total_page
      : typeof pageInfo.total_page === 'string' &&
          INTEGER.test(pageInfo.total_page)
        ? Number(pageInfo.total_page)
        : Number.NaN;
  if (
    !Number.isSafeInteger(current) ||
    !Number.isSafeInteger(total) ||
    current < 1 ||
    total < 0 ||
    (total === 0 ? hasRows || current !== 1 : current > total)
  )
    throw new TikTokAdsProviderError('TIKTOK_ADS_REPORT_PAGING_INVALID');
  return current < total ? current + 1 : null;
}

export async function fetchTikTokAdsDailyReport(
  input: {
    accessToken: string;
    accountId: string;
    currencyCode?: string | null;
    endDate: string;
    startDate: string;
    timezoneName?: string | null;
  },
  fetchImpl: typeof fetch = fetch,
  sleep?: (milliseconds: number) => Promise<void>
): Promise<TikTokAdsDailyReport[]> {
  if (
    !input.accountId.trim() ||
    !ISO_DATE.test(input.startDate) ||
    !ISO_DATE.test(input.endDate) ||
    input.startDate > input.endDate
  )
    throw new TikTokAdsProviderError('TIKTOK_ADS_REPORT_INPUT_INVALID');
  const retryBudget = createTikTokAdsRetryBudget();
  const results: TikTokAdsDailyReport[] = [];
  let page = 1;
  for (let count = 0; count < MAX_PAGES; count += 1) {
    const url = new URL(`${TIKTOK_ADS_API_ROOT}/report/integrated/get/`);
    for (const [key, value] of Object.entries({
      advertiser_id: input.accountId,
      data_level: 'AUCTION_ADVERTISER',
      dimensions: JSON.stringify(['advertiser_id', 'stat_time_day']),
      end_date: input.endDate,
      metrics: JSON.stringify([
        'spend',
        'impressions',
        'clicks',
        'conversion',
        'currency',
        'reach',
      ]),
      page: String(page),
      page_size: '1000',
      report_type: 'BASIC',
      service_type: 'AUCTION',
      start_date: input.startDate,
    }))
      url.searchParams.set(key, value);
    const payload = await requestTikTokAdsJson(
      url,
      { headers: { 'Access-Token': input.accessToken } },
      'TIKTOK_ADS_REPORT_FAILED',
      fetchImpl,
      { retryBudget, sleep }
    );
    const pageRows = parseReportRows(payload, {
      accountId: input.accountId,
      currencyCode: input.currencyCode ?? null,
      timezoneName: input.timezoneName ?? null,
    });
    results.push(...pageRows);
    const next = nextPage(payload, pageRows.length > 0);
    if (!next) return results;
    page = next;
  }
  throw new TikTokAdsProviderError('TIKTOK_ADS_REPORT_PAGING_LIMIT');
}
