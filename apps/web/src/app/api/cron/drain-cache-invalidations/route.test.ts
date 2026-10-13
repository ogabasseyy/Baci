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

function makeClaim(index: number) {
  return {
    ...claim,
    claim_token: `11111111-1111-4111-8111-${index.toString().padStart(12, '0')}`,
    target_id: `shop-${index}`,
  };
}

function request(secret = 'cron-secret') {
  return new Request(
    'https://app.usebaci.com/api/cron/drain-cache-invalidations',
    {
      headers: { Authorization: `Bearer ${secret}` },
    }
  );
}

describe('GET /api/cron/drain-cache-invalidations', () => {
  const rpc = vi.fn();
  let claimCalls = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    mocks.createServiceClient.mockReturnValue({ rpc });
    claimCalls = 0;
    rpc.mockImplementation((name: string) => {
      if (name === 'claim_cache_invalidations') {
        claimCalls += 1;
        return Promise.resolve({
          data: claimCalls === 1 ? [claim] : [],
          error: null,
        });
      }
      if (name === 'has_cache_invalidation_dead_letters') {
        return Promise.resolve({ data: false, error: null });
      }
      return Promise.resolve({ data: true, error: null });
    });
    mocks.drain.mockResolvedValue({ ok: true });
  });

  it('authenticates before claiming, uses optional finish defaults, and completes after ordered delivery', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      deadLettersPresent: false,
    });
    expect(rpc).toHaveBeenNthCalledWith(1, 'claim_cache_invalidations', {
      p_batch_size: 5,
      p_worker_id: expect.stringMatching(/^next-cron-/),
    });
    const finishArgs = rpc.mock.calls[1]?.[1];
    expect(finishArgs).toMatchObject({ p_succeeded: true });
    expect(finishArgs).not.toHaveProperty('p_error_code');
    expect(finishArgs).not.toHaveProperty('p_retry_after_seconds');
    expect(mocks.drain.mock.invocationCallOrder[0]).toBeLessThan(
      rpc.mock.invocationCallOrder[1]
    );
  });
  it('rejects an invalid secret before constructing privileged authority', async () => {
    const response = await GET(request('wrong'));

    expect(response.status).toBe(401);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });
  it('records a retry when an outer stage is not confirmed', async () => {
    mocks.drain.mockResolvedValue({
      errorCode: 'cloudflare_request_failed',
      ok: false,
      retryAfterSeconds: 120,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      claimed: 1,
      completed: 0,
      failed: 1,
      deadLettersPresent: false,
    });
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'finish_cache_invalidation',
      expect.objectContaining({
        p_error_code: 'cloudflare_request_failed',
        p_retry_after_seconds: 120,
        p_succeeded: false,
      })
    );
  });

  it('persists an unexpected drainer failure and continues the claimed batch', async () => {
    const firstClaim = makeClaim(1);
    const secondClaim = makeClaim(2);
    const batches = [[firstClaim, secondClaim], []];
    rpc.mockImplementation((name: string) => {
      if (name === 'claim_cache_invalidations') {
        return Promise.resolve({ data: batches.shift() ?? [], error: null });
      }
      if (name === 'has_cache_invalidation_dead_letters') {
        return Promise.resolve({ data: false, error: null });
      }
      return Promise.resolve({ data: true, error: null });
    });
    mocks.drain
      .mockRejectedValueOnce(new Error('unexpected provider failure'))
      .mockResolvedValueOnce({ ok: true });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      claimed: 2,
      completed: 1,
      failed: 1,
      deadLettersPresent: false,
    });
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'finish_cache_invalidation',
      expect.objectContaining({
        p_claim_token: firstClaim.claim_token,
        p_error_code: 'drain_unexpected_failure',
        p_succeeded: false,
      })
    );
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      'finish_cache_invalidation',
      expect.objectContaining({
        p_claim_token: secondClaim.claim_token,
        p_succeeded: true,
      })
    );
  });

  it('drains successive claim batches before reporting the invocation summary', async () => {
    const batches = [
      Array.from({ length: 2 }, (_, index) => makeClaim(index + 1)),
      [makeClaim(3)],
      [],
    ];
    rpc.mockImplementation((name: string) => {
      if (name === 'claim_cache_invalidations') {
        return Promise.resolve({ data: batches.shift() ?? [], error: null });
      }
      if (name === 'has_cache_invalidation_dead_letters') {
        return Promise.resolve({ data: false, error: null });
      }
      return Promise.resolve({ data: true, error: null });
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      claimed: 3,
      completed: 3,
      failed: 0,
      deadLettersPresent: false,
    });
    expect(
      rpc.mock.calls.filter(([name]) => name === 'claim_cache_invalidations')
    ).toHaveLength(3);
  });

  it('stops at the fixed target budget even while full batches remain ready', async () => {
    let nextIndex = 1;
    rpc.mockImplementation((name: string) => {
      if (name === 'claim_cache_invalidations') {
        const batch = Array.from({ length: 2 }, () => makeClaim(nextIndex++));
        return Promise.resolve({ data: batch, error: null });
      }
      if (name === 'has_cache_invalidation_dead_letters') {
        return Promise.resolve({ data: false, error: null });
      }
      return Promise.resolve({ data: true, error: null });
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      claimed: 10,
      completed: 10,
      failed: 0,
      deadLettersPresent: false,
    });
    expect(
      rpc.mock.calls.filter(([name]) => name === 'claim_cache_invalidations')
    ).toHaveLength(5);
  });

  it('stops claiming when the invocation reaches the reserved time cutoff', async () => {
    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000)
      .mockReturnValue(31_000);
    rpc.mockImplementation((name: string) => {
      if (name === 'claim_cache_invalidations') {
        return Promise.resolve({
          data: [makeClaim(1), makeClaim(2)],
          error: null,
        });
      }
      if (name === 'has_cache_invalidation_dead_letters') {
        return Promise.resolve({ data: false, error: null });
      }
      return Promise.resolve({ data: true, error: null });
    });

    const response = await GET(request());
    now.mockRestore();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      claimed: 2,
      completed: 2,
      failed: 0,
      deadLettersPresent: false,
    });
    expect(
      rpc.mock.calls.filter(([name]) => name === 'claim_cache_invalidations')
    ).toHaveLength(1);
  });

  it('returns a fixed non-2xx alert while terminal dead letters exist', async () => {
    rpc.mockImplementation((name: string) => {
      if (name === 'claim_cache_invalidations') {
        return Promise.resolve({ data: [], error: null });
      }
      if (name === 'has_cache_invalidation_dead_letters') {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: true, error: null });
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deadLettersPresent: true });
  });

  it('fails closed when the dead-letter alert state cannot be read', async () => {
    rpc.mockImplementation((name: string) => {
      if (name === 'claim_cache_invalidations') {
        return Promise.resolve({ data: [], error: null });
      }
      if (name === 'has_cache_invalidation_dead_letters') {
        return Promise.resolve({
          data: null,
          error: { message: 'database unavailable' },
        });
      }
      return Promise.resolve({ data: true, error: null });
    });

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Failed to read invalidation alert state',
    });
  });
});
