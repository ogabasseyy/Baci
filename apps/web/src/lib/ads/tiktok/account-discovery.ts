import 'server-only';

import { z } from 'zod';
import { resolveTikTokAdsAccountMetadata } from './account-metadata';
import { TIKTOK_ADS_API_ROOT } from './constants';
import type { TikTokAdsAccount } from './provider-types';
import {
  createTikTokAdsRetryBudget,
  requestTikTokAdsJson,
  TikTokAdsProviderError,
} from './request';

const INTEGER = /^\d+$/;
const ACCOUNT_PAGE_SIZE = 100;
const MAX_ACCOUNT_PAGES = 20;

function record(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

function nextAccountPage(
  payload: unknown,
  requestedPage: number,
  hasRows: boolean
): number | null {
  const pageInfo = record(record(record(payload)?.data)?.page_info);
  if (!pageInfo) {
    if (hasRows)
      throw new TikTokAdsProviderError(
        'TIKTOK_ADS_ACCOUNT_DISCOVERY_PAGING_INVALID'
      );
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
    total < 1 ||
    current !== requestedPage ||
    current > total
  )
    throw new TikTokAdsProviderError(
      'TIKTOK_ADS_ACCOUNT_DISCOVERY_PAGING_INVALID'
    );
  return current < total ? current + 1 : null;
}

const accountSchema = z.object({
  advertiser_id: z.string().trim().min(1).max(255),
  advertiser_name: z.string().trim().min(1).max(255),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  timezone: z.string().trim().min(1).max(128).optional(),
});

function parseAccountCandidates(payload: unknown): {
  candidates: Array<{
    accountId: string;
    currencyCode: string | null;
    label: string;
    timezoneName: string | null;
  }>;
  hasRows: boolean;
} {
  const data = record(record(payload)?.data);
  const list = data?.list;
  if (!Array.isArray(list))
    throw new TikTokAdsProviderError('TIKTOK_ADS_ACCOUNT_DISCOVERY_INVALID');
  return {
    candidates: list.flatMap((item) => {
      const parsed = accountSchema.safeParse(item);
      return parsed.success
        ? [
            {
              accountId: parsed.data.advertiser_id,
              currencyCode: parsed.data.currency ?? null,
              label: parsed.data.advertiser_name,
              timezoneName: parsed.data.timezone ?? null,
            },
          ]
        : [];
    }),
    hasRows: list.length > 0,
  };
}

export async function listTikTokAdsAccounts(
  input: { accessToken: string; appId: string; appSecret: string },
  fetchImpl: typeof fetch = fetch,
  sleep?: (milliseconds: number) => Promise<void>
): Promise<TikTokAdsAccount[]> {
  const retryBudget = createTikTokAdsRetryBudget();
  const candidates: Array<{
    accountId: string;
    currencyCode: string | null;
    label: string;
    timezoneName: string | null;
  }> = [];
  let page = 1;
  for (let count = 0; count < MAX_ACCOUNT_PAGES; count += 1) {
    const url = new URL(`${TIKTOK_ADS_API_ROOT}/oauth2/advertiser/get/`);
    url.searchParams.set('app_id', input.appId);
    url.searchParams.set('page', String(page));
    url.searchParams.set('page_size', String(ACCOUNT_PAGE_SIZE));
    url.searchParams.set('secret', input.appSecret);
    const payload = await requestTikTokAdsJson(
      url,
      { headers: { 'Access-Token': input.accessToken } },
      'TIKTOK_ADS_ACCOUNT_DISCOVERY_FAILED',
      fetchImpl,
      { retryBudget, sleep }
    );
    const parsedPage = parseAccountCandidates(payload);
    candidates.push(...parsedPage.candidates);
    const next = nextAccountPage(payload, page, parsedPage.hasRows);
    if (!next) break;
    page = next;
    if (count === MAX_ACCOUNT_PAGES - 1)
      throw new TikTokAdsProviderError(
        'TIKTOK_ADS_ACCOUNT_DISCOVERY_PAGING_LIMIT'
      );
  }

  const incomplete = candidates.filter(
    (account) => !account.currencyCode || !account.timezoneName
  );
  const metadata = await resolveTikTokAdsAccountMetadata(
    {
      accessToken: input.accessToken,
      advertiserIds: incomplete.map((account) => account.accountId),
    },
    fetchImpl,
    sleep,
    retryBudget
  );
  return candidates.flatMap((account) => {
    const resolved = metadata.get(account.accountId);
    const currencyCode = account.currencyCode ?? resolved?.currencyCode;
    const timezoneName = account.timezoneName ?? resolved?.timezoneName;
    return currencyCode && timezoneName
      ? [{ ...account, currencyCode, timezoneName }]
      : [];
  });
}
