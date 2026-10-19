import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from '@/lib/cache';
import type { Database } from '@/types/supabase';

const ADS_ANALYTICS_CACHE_PREFIX = 'ad-analytics';
const ADS_ANALYTICS_CONNECTION_VERSION_SELECT = 'provider, updated_at';

type AdsAnalyticsConnectionVersionRow = Pick<
  Database['public']['Tables']['merchant_ad_connections']['Row'],
  'provider' | 'updated_at'
>;

/**
 * Read the durable connection revision used by analytics cache keys.
 *
 * `cache` is intentionally process-local, so deleting a key only evicts the
 * Vercel instance that handled the mutation. Every connection mutation has an
 * `updated_at` trigger; incorporating those timestamps into the key makes a
 * different instance miss its old snapshot after the durable row changes.
 * This query deliberately selects no credential columns.
 */
export async function getAdsAnalyticsCacheVersion(
  supabase: SupabaseClient<Database>,
  merchantId: string
): Promise<string | undefined> {
  const normalizedMerchantId = merchantId.trim();
  if (!normalizedMerchantId) return undefined;

  try {
    const { data, error } = await supabase
      .from('merchant_ad_connections')
      .select(ADS_ANALYTICS_CONNECTION_VERSION_SELECT)
      .eq('merchant_id', normalizedMerchantId)
      .order('provider', { ascending: true });

    if (error) return undefined;

    const rows = (data ?? []) as AdsAnalyticsConnectionVersionRow[];
    const revisions = rows
      .map((row) => `${row.provider}:${row.updated_at}`)
      .sort();

    // A missing connection is a durable state too: transitioning from a row
    // to no rows must not keep serving the previous provider snapshot.
    return revisions.length > 0 ? revisions.join('|') : 'empty';
  } catch {
    // Cache availability is best effort. If the marker read is unavailable,
    // callers should bypass caching rather than risk serving stale analytics.
    return undefined;
  }
}

export function buildAdsAnalyticsCacheKey(input: {
  endDate: string;
  merchantId: string;
  orderEnd?: string;
  orderStart?: string;
  startDate: string;
  version: string;
}): string | undefined {
  const normalizedMerchantId = input.merchantId.trim();
  const normalizedVersion = input.version.trim();
  if (!normalizedMerchantId || !normalizedVersion) return undefined;

  const orderRange =
    input.orderStart && input.orderEnd
      ? `:${input.orderStart}:${input.orderEnd}`
      : '';
  return `${ADS_ANALYTICS_CACHE_PREFIX}:${normalizedMerchantId}:${input.startDate}:${input.endDate}${orderRange}:${normalizedVersion}`;
}

/**
 * Evict every date-range snapshot for a merchant after an ads connection
 * changes. The analytics endpoint keys snapshots as
 * `ad-analytics:<merchant>:<start>:<end>:<durable-revision>`; using the
 * merchant-scoped prefix keeps other merchants' snapshots untouched without
 * including any provider credentials in the cache key or invalidation path.
 */
export function invalidateAdsAnalyticsCache(merchantId: string): void {
  const normalizedMerchantId = merchantId.trim();
  if (!normalizedMerchantId) return;

  cache.deletePattern(
    `${ADS_ANALYTICS_CACHE_PREFIX}:${normalizedMerchantId}:*`
  );
}
