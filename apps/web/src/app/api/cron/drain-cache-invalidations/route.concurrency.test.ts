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

const claim = {
  attempts: 1,
  claim_token: '11111111-1111-4111-8111-111111111111',
  generation: 2,
  merchant_id: '22222222-2222-4222-8222-222222222222',
  product_slugs: ['cache-phone'],
  related_identifiers: ['shop-one', 'shop.example.com'],
  target_id: 'shop-one',
  target_kind: 'storefront_slug',
};

function request() {
  return new Request(
    'https://app.usebaci.com/api/cron/drain-cache-invalidations',
    { headers: { Authorization: 'Bearer cron-secret' } }
  );
}

describe('drain-cache-invalidations concurrent dead-letter snapshot', () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    mocks.createServiceClient.mockReturnValue({ rpc });
    mocks.drain.mockResolvedValue({ ok: true });
  });

  it('starts dead-letter check concurrently with initial claim and skips re-query when failed === 0', async () => {
    let resolveClaim!: (value: { data: unknown[]; error: null }) => void;
    let resolveDeadLetters!: (value: { data: boolean; error: null }) => void;
    const claimPromise = new Promise<{ data: unknown[]; error: null }>(
      (resolve) => {
        resolveClaim = resolve;
      }
    );
    const deadLettersPromise = new Promise<{ data: boolean; error: null }>(
      (resolve) => {
        resolveDeadLetters = resolve;
      }
    );

    rpc.mockImplementation((name: string) => {
      if (name === 'claim_cache_invalidations') {
        const callCount = rpc.mock.calls.filter(
          ([fn]) => fn === 'claim_cache_invalidations'
        ).length;
        return callCount === 1
          ? claimPromise
          : Promise.resolve({ data: [], error: null });
      }
      if (name === 'has_cache_invalidation_dead_letters') {
        return deadLettersPromise;
      }
      return Promise.resolve({ data: true, error: null });
    });

    const responsePromise = GET(request());
    await vi.waitFor(() => {
      expect(rpc).toHaveBeenCalledWith(
        'claim_cache_invalidations',
        expect.any(Object)
      );
      expect(rpc).toHaveBeenCalledWith('has_cache_invalidation_dead_letters');
    });

    resolveDeadLetters({ data: false, error: null });
    resolveClaim({ data: [claim], error: null });

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      deadLettersPresent: false,
    });
    expect(
      rpc.mock.calls.filter(
        ([name]) => name === 'has_cache_invalidation_dead_letters'
      )
    ).toHaveLength(1);
  });

  it('re-checks dead letters after the loop when any invalidation fails', async () => {
    let claimCount = 0;
    const deadLetterResponses = [false, true];
    rpc.mockImplementation((name: string) => {
      if (name === 'claim_cache_invalidations') {
        claimCount += 1;
        return Promise.resolve({
          data: claimCount === 1 ? [claim] : [],
          error: null,
        });
      }
      if (name === 'has_cache_invalidation_dead_letters') {
        return Promise.resolve({
          data: deadLetterResponses.shift() ?? false,
          error: null,
        });
      }
      return Promise.resolve({ data: true, error: null });
    });
    mocks.drain.mockResolvedValue({
      errorCode: 'cloudflare_request_failed',
      ok: false,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      claimed: 1,
      completed: 0,
      failed: 1,
      deadLettersPresent: true,
    });
    expect(
      rpc.mock.calls.filter(
        ([name]) => name === 'has_cache_invalidation_dead_letters'
      )
    ).toHaveLength(2);
  });
});
