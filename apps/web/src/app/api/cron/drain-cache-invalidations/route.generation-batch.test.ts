import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  drain: vi.fn(),
}));
vi.mock('@/lib/drain-storefront-cache-invalidation', () => ({
  drainStorefrontCacheInvalidation: mocks.drain,
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}));

import { GET } from './route';

const shared = {
  attempts: 1,
  generation: 9,
  merchant_id: '22222222-2222-4222-8222-222222222222',
  product_slugs: ['cache-phone'],
  related_identifiers: [
    'shop-one',
    'shop-two',
    'shop-three',
    'shop.example.com',
  ],
};

function claim(targetId: string, tokenSuffix: string) {
  return {
    ...shared,
    claim_token: `11111111-1111-4111-8111-${tokenSuffix}`,
    target_id: targetId,
    target_kind: 'storefront_slug' as const,
  };
}

describe('bugfix: shared-generation drain repeats provider work across batches', () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    mocks.createServiceClient.mockReturnValue({ rpc });
    mocks.drain.mockResolvedValue({ ok: true });
    let claimCalls = 0;
    rpc.mockImplementation((name: string) => {
      if (name === 'claim_cache_invalidations') {
        claimCalls += 1;
        if (claimCalls === 1) {
          return Promise.resolve({
            data: [
              claim('shop-one', '000000000001'),
              claim('shop-two', '000000000002'),
            ],
            error: null,
          });
        }
        if (claimCalls === 2) {
          return Promise.resolve({
            data: [
              claim('shop-three', '000000000003'),
              claim('shop-four', '000000000004'),
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      }
      if (name === 'has_cache_invalidation_dead_letters') {
        return Promise.resolve({ data: false, error: null });
      }
      return Promise.resolve({ data: true, error: null });
    });
  });

  it('drains one shared generation once then finishes later sibling claims without re-purging', async () => {
    const response = await GET(
      new Request(
        'https://app.usebaci.com/api/cron/drain-cache-invalidations',
        { headers: { Authorization: 'Bearer cron-secret' } }
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      claimed: 4,
      completed: 4,
      failed: 0,
      deadLettersPresent: false,
    });
    // First batch drains concurrently; later same-generation batch skips purge.
    expect(mocks.drain).toHaveBeenCalledTimes(2);
    const finishCalls = rpc.mock.calls.filter(
      ([name]) => name === 'finish_cache_invalidation'
    );
    expect(finishCalls).toHaveLength(4);
    expect(finishCalls.every(([, args]) => args?.p_succeeded === true)).toBe(
      true
    );
  });
});
