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

describe('bugfix: legacy related_identifiers must not skip divergent purges', () => {
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
              {
                attempts: 1,
                claim_token: '11111111-1111-4111-8111-000000000021',
                generation: 4,
                merchant_id: '22222222-2222-4222-8222-222222222222',
                product_slugs: ['cache-phone'],
                related_identifiers: ['shop-one'],
                target_id: 'shop-one',
                target_kind: 'storefront_slug' as const,
              },
            ],
            error: null,
          });
        }
        if (claimCalls === 2) {
          return Promise.resolve({
            data: [
              {
                attempts: 1,
                claim_token: '11111111-1111-4111-8111-000000000022',
                generation: 4,
                merchant_id: '22222222-2222-4222-8222-222222222222',
                product_slugs: ['cache-phone'],
                related_identifiers: ['shop-two'],
                target_id: 'shop-two',
                target_kind: 'storefront_slug' as const,
              },
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

  it('drains later legacy siblings when related identifier coverage differs', async () => {
    const response = await GET(
      new Request(
        'https://app.usebaci.com/api/cron/drain-cache-invalidations',
        { headers: { Authorization: 'Bearer cron-secret' } }
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      claimed: 2,
      completed: 2,
      failed: 0,
      deadLettersPresent: false,
    });
    expect(mocks.drain).toHaveBeenCalledTimes(2);
  });
});
