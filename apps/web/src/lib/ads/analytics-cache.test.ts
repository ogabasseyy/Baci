import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/supabase';

const { deletePattern, from } = vi.hoisted(() => ({
  deletePattern: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/lib/cache', () => ({
  cache: { deletePattern },
}));

import {
  buildAdsAnalyticsCacheKey,
  getAdsAnalyticsCacheVersion,
  invalidateAdsAnalyticsCache,
} from './analytics-cache';

describe('invalidateAdsAnalyticsCache', () => {
  beforeEach(() => {
    deletePattern.mockClear();
    from.mockReset();
  });

  it('evicts every date range for only the selected merchant', () => {
    invalidateAdsAnalyticsCache(' merchant-1 ');

    expect(deletePattern).toHaveBeenCalledOnce();
    expect(deletePattern).toHaveBeenCalledWith('ad-analytics:merchant-1:*');
  });

  it('does not issue a broad invalidation for an empty merchant id', () => {
    invalidateAdsAnalyticsCache('   ');

    expect(deletePattern).not.toHaveBeenCalled();
  });
});

describe('durable ads analytics cache revisions', () => {
  it('derives a stable version from merchant connection timestamps', async () => {
    const query = createVersionQuery({
      data: [
        {
          provider: 'tiktok_ads',
          updated_at: '2026-08-26T10:00:00.000Z',
        },
        {
          provider: 'google_ads',
          updated_at: '2026-08-26T09:00:00.000Z',
        },
      ],
      error: null,
    });
    from.mockReturnValue(query);

    const version = await getAdsAnalyticsCacheVersion(
      { from } as unknown as SupabaseClient<Database>,
      ' merchant-1 '
    );

    expect(version).toBe(
      'google_ads:2026-08-26T09:00:00.000Z|tiktok_ads:2026-08-26T10:00:00.000Z'
    );
    expect(from).toHaveBeenCalledWith('merchant_ad_connections');
    expect(query.select).toHaveBeenCalledWith('provider, updated_at');
    expect(query.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(query.order).toHaveBeenCalledWith('provider', { ascending: true });
  });

  it('uses an explicit empty revision when all durable connections are gone', async () => {
    from.mockReturnValue(createVersionQuery({ data: [], error: null }));

    await expect(
      getAdsAnalyticsCacheVersion(
        { from } as unknown as SupabaseClient<Database>,
        'merchant-1'
      )
    ).resolves.toBe('empty');
  });

  it('returns unavailable when the durable marker query fails', async () => {
    from.mockReturnValue(
      createVersionQuery({ data: null, error: new Error('database down') })
    );

    await expect(
      getAdsAnalyticsCacheVersion(
        { from } as unknown as SupabaseClient<Database>,
        'merchant-1'
      )
    ).resolves.toBeUndefined();
  });

  it('changes the cache key when another instance observes a new durable revision', () => {
    const beforeMutation = buildAdsAnalyticsCacheKey({
      endDate: '2026-08-26',
      merchantId: ' merchant-1 ',
      startDate: '2026-08-01',
      version: 'meta_ads:2026-08-26T09:00:00.000Z',
    });
    const afterMutation = buildAdsAnalyticsCacheKey({
      endDate: '2026-08-26',
      merchantId: 'merchant-1',
      startDate: '2026-08-01',
      version: 'meta_ads:2026-08-26T10:00:00.000Z',
    });

    expect(beforeMutation).toBe(
      'ad-analytics:merchant-1:2026-08-01:2026-08-26:meta_ads:2026-08-26T09:00:00.000Z'
    );
    expect(afterMutation).not.toBe(beforeMutation);
  });

  it('separates exact order windows that share provider calendar dates', () => {
    const morning = buildAdsAnalyticsCacheKey({
      endDate: '2026-08-26',
      merchantId: 'merchant-1',
      orderEnd: '2026-08-26T12:00:00.000Z',
      orderStart: '2026-08-01T12:00:00.000Z',
      startDate: '2026-08-01',
      version: 'empty',
    });
    const evening = buildAdsAnalyticsCacheKey({
      endDate: '2026-08-26',
      merchantId: 'merchant-1',
      orderEnd: '2026-08-26T18:00:00.000Z',
      orderStart: '2026-08-01T18:00:00.000Z',
      startDate: '2026-08-01',
      version: 'empty',
    });

    expect(morning).not.toBe(evening);
  });
});

function createVersionQuery(result: { data: unknown; error: unknown }) {
  const query = {
    eq: vi.fn(),
    order: vi.fn(),
    select: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockResolvedValue(result);
  return query;
}
