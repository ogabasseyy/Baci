import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function request() {
  return new Request(
    'https://app.usebaci.com/api/cron/drain-cache-invalidations',
    { headers: { Authorization: 'Bearer cron-secret' } }
  );
}

describe('cache invalidation dead-letter alert cache', () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    mocks.createServiceClient.mockReturnValue({ rpc });
    rpc.mockImplementation((name: string) => {
      if (name === 'claim_cache_invalidations') {
        return Promise.resolve({ data: [], error: null });
      }
      if (name === 'has_cache_invalidation_dead_letters') {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: true, error: null });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns durable dead-letter visibility without emitting an HTTP alert', async () => {
    const first = await GET(request());
    const second = await GET(request());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      deadLettersPresent: true,
    });
    await expect(second.json()).resolves.toMatchObject({
      deadLettersPresent: true,
    });
    expect(
      rpc.mock.calls.filter(
        ([name]) => name === 'has_cache_invalidation_dead_letters'
      )
    ).toHaveLength(2);
  });

  it('reflects remediation and later dead-letter transitions', async () => {
    const alertStates = [true, false, true];
    rpc.mockImplementation((name: string) => {
      if (name === 'claim_cache_invalidations') {
        return Promise.resolve({ data: [], error: null });
      }
      if (name === 'has_cache_invalidation_dead_letters') {
        return Promise.resolve({ data: alertStates.shift(), error: null });
      }
      return Promise.resolve({ data: true, error: null });
    });

    const first = await GET(request());
    const second = await GET(request());
    const third = await GET(request());
    await expect(first.json()).resolves.toMatchObject({
      deadLettersPresent: true,
    });
    await expect(second.json()).resolves.toMatchObject({
      deadLettersPresent: false,
    });
    await expect(third.json()).resolves.toMatchObject({
      deadLettersPresent: true,
    });

    expect(
      rpc.mock.calls.filter(
        ([name]) => name === 'has_cache_invalidation_dead_letters'
      )
    ).toHaveLength(3);
  });
});
