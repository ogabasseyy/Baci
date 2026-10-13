import 'server-only';

import { z } from 'zod';
import { TIKTOK_ADS_API_ROOT } from './constants';
import {
  createTikTokAdsRetryBudget,
  requestTikTokAdsJson,
  TikTokAdsProviderError,
  type TikTokAdsRetryBudget,
} from './request';

const metadataSchema = z.object({
  advertiser_id: z.string().trim().min(1).max(255),
  currency: z.string().regex(/^[A-Z]{3}$/),
  timezone: z.string().trim().min(1).max(128),
});

function record(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

export async function resolveTikTokAdsAccountMetadata(
  input: { accessToken: string; advertiserIds: string[] },
  fetchImpl: typeof fetch = fetch,
  sleep?: (milliseconds: number) => Promise<void>,
  retryBudget: TikTokAdsRetryBudget = createTikTokAdsRetryBudget()
): Promise<Map<string, { currencyCode: string; timezoneName: string }>> {
  if (input.advertiserIds.length === 0) return new Map();
  const url = new URL(`${TIKTOK_ADS_API_ROOT}/advertiser/info/`);
  url.searchParams.set('advertiser_ids', JSON.stringify(input.advertiserIds));
  url.searchParams.set(
    'fields',
    JSON.stringify(['advertiser_id', 'currency', 'timezone'])
  );
  const payload = await requestTikTokAdsJson(
    url,
    { headers: { 'Access-Token': input.accessToken } },
    'TIKTOK_ADS_ACCOUNT_METADATA_FAILED',
    fetchImpl,
    { retryBudget, sleep }
  );
  const list = record(record(payload)?.data)?.list;
  if (!Array.isArray(list))
    throw new TikTokAdsProviderError('TIKTOK_ADS_ACCOUNT_METADATA_INVALID');
  const metadata = new Map<
    string,
    { currencyCode: string; timezoneName: string }
  >();
  for (const item of list) {
    const parsed = metadataSchema.safeParse(item);
    if (parsed.success) {
      metadata.set(parsed.data.advertiser_id, {
        currencyCode: parsed.data.currency,
        timezoneName: parsed.data.timezone,
      });
    }
  }
  return metadata;
}
