import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrilStashPageCorrelation } from '@/lib/brilstash/page-correlation';
import * as routeModule from './route';
import { feedFixture } from './route.test-fixture';

const dependencies = vi.hoisted(() => {
  const abortSignal = vi.fn();
  const rpc = vi.fn(() => ({ setHeader: vi.fn(() => ({ abortSignal })) }));
  return { rpc, abortSignal, info: vi.fn(), warn: vi.fn(), rateLimit: vi.fn() };
});

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({ rpc: dependencies.rpc }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: dependencies.info, warn: dependencies.warn },
}));

vi.mock('@/lib/brilstash/feed-rate-limit', () => ({
  checkBrilStashFeedRateLimit: dependencies.rateLimit,
}));

const { GET } = routeModule;
const { bearer, host, request, result } = feedFixture;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('BRILSTASH_FEED_HOST', host);
  vi.stubEnv('BRILSTASH_FEED_INGRESS_KEY', 'a'.repeat(64));
  vi.stubEnv('BRILSTASH_FEED_ENV', 'sandbox');
  vi.stubEnv('BRILSTASH_SUPABASE_PROJECT_REF', 'sandboxtest');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sandboxtest.supabase.co');
  vi.stubEnv('VERCEL_ENV', 'preview');
  dependencies.abortSignal.mockResolvedValue({ data: result, error: null });
  dependencies.rateLimit.mockReset().mockResolvedValue({
    allowed: true,
    limit: 30,
    remaining: 29,
    resetTime: Date.now() + 60_000,
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('BrilStash feed GET', () => {
  it('returns a non-cacheable 429 before the RPC when the partner feed budget is exhausted', async () => {
    dependencies.rateLimit.mockResolvedValueOnce({
      allowed: false,
      limit: 30,
      remaining: 0,
      resetTime: Date.now() + 60_000,
    });
    const input = request();
    const response = await GET(input);

    expect(dependencies.rateLimit).toHaveBeenCalledWith(input, 'read');
    expect(dependencies.rpc).not.toHaveBeenCalled();
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBeTruthy();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(dependencies.warn).not.toHaveBeenCalled();
  });

  it.each([
    'trusted_client_ip_missing',
    'distributed_limiter_unavailable',
  ])('logs limiter failure %s without changing the 429 contract', async (failureReason) => {
    dependencies.rateLimit.mockResolvedValueOnce({
      allowed: false,
      limit: 30,
      remaining: 0,
      resetTime: Date.now() + 60_000,
      failureReason,
    });
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(await response.text()).not.toContain(failureReason);
    expect(dependencies.rpc).not.toHaveBeenCalled();
    expect(dependencies.warn).toHaveBeenCalledExactlyOnceWith({
      message: 'BrilStash feed rate limiter unavailable',
      requestId: response.headers.get('x-request-id'),
      reason: failureReason,
    });
  });

  it.each([
    ['?limit=1', 'short'],
    ['?limit=wrong', bearer],
  ])('charges malformed credential or query requests against the feed budget', async (query, token) => {
    dependencies.rateLimit.mockResolvedValueOnce({
      allowed: false,
      limit: 30,
      remaining: 0,
      resetTime: Date.now() + 60_000,
    });
    const input = request(query, token);
    const response = await GET(input);
    expect(dependencies.rateLimit).toHaveBeenCalledWith(input, 'malformed');
    expect(response.status).toBe(429);
    expect(dependencies.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [`${host}:443`, 200],
    [`${host}:8443`, 404],
    [`${host}.`, 404],
    [`${host}:443, other.example.invalid`, 404],
  ])('checks the configured hostname with a default HTTPS port only', async (authority, status) => {
    const input = request();
    input.headers.set('host', authority);
    expect((await GET(input)).status).toBe(status);
  });

  it('serves a bare array with totals and no-store, and logs correlation without the key', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('x-total-count')).toBe('7');
    expect(response.headers.get('x-total-pages')).toBe('7');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const requestId = response.headers.get('x-request-id');
    expect(requestId).toBeTruthy();
    expect(response.headers.get('x-baci-catalogue-correlation')).toBeNull();
    expect(await response.json()).toEqual(result.products);
    expect(dependencies.rpc).toHaveBeenCalledWith('read_brilstash_page', {
      p_bearer: bearer,
      p_page: 1,
      p_limit: 1,
      p_min_price: 350000,
    });
    expect(dependencies.abortSignal).toHaveBeenCalledWith(
      expect.any(AbortSignal)
    );
    expect(JSON.stringify(dependencies.info.mock.calls)).not.toContain(bearer);
  });

  it('correlates only the exact unfiltered handoff request', async () => {
    dependencies.abortSignal.mockResolvedValueOnce({
      data: { ...result, totalCount: 1, totalPages: 1 },
      error: null,
    });
    const response = await GET(request('?page=1&limit=100&min_price=0'));
    const requestId = response.headers.get('x-request-id');
    expect(response.status).toBe(200);
    expect(response.headers.get('x-baci-catalogue-correlation')).toBe(
      createBrilStashPageCorrelation(requestId ?? '', result)
    );
    expect(dependencies.info).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId,
        keyId: result.credentialId,
        generationId: result.generationId,
      })
    );
  });

  it.each([
    [request('?page=1&page=2'), 400],
    [request('', null), 401],
    [request('', 'short'), 401],
    [request('', bearer, 'other.example.invalid'), 404],
  ])('rejects locally without RPC', async (invalidRequest, status) => {
    const response = await GET(invalidRequest);
    expect(response.status).toBe(status);
    expect(dependencies.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['?page=1&limit=6', 400],
    ['?page=1&limit=7', 200],
    ['?page=1&limit=8', 200],
    ['?page=1&limit=100', 200],
    ['?page=2', 400],
    ['?min_price=1', 400],
    ['?page=1&limit=100&min_price=250000', 200],
    ['?page=1&limit=100&min_price=250001', 400],
  ])('enforces the live single-page contract for %s', async (query, status) => {
    vi.stubEnv('BRILSTASH_FEED_ENV', 'live');
    vi.stubEnv('VERCEL_ENV', 'production');
    dependencies.abortSignal.mockResolvedValue({
      data: { ...result, totalCount: 1, totalPages: 1 },
      error: null,
    });
    expect((await GET(request(query))).status).toBe(status);
    expect(dependencies.rpc).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
  });

  it('rejects an empty live result even with internally consistent totals', async () => {
    vi.stubEnv('BRILSTASH_FEED_ENV', 'live');
    vi.stubEnv('VERCEL_ENV', 'production');
    dependencies.abortSignal.mockResolvedValueOnce({
      data: { ...result, products: [], totalCount: 0, totalPages: 0 },
      error: null,
    });

    const response = await GET(request('?page=1&limit=7'));
    expect(response.status).toBe(503);
    expect(response.headers.has('x-total-count')).toBe(false);
    expect(response.headers.has('x-baci-catalogue-correlation')).toBe(false);
  });

  it('fails closed on a database project mismatch and on live configuration in preview', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://liveproject.supabase.co');
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(dependencies.warn).toHaveBeenCalledWith({
      message: 'BrilStash feed deployment is misconfigured',
      requestId: response.headers.get('x-request-id'),
    });
    expect(await response.text()).not.toContain('liveproject');
    vi.stubEnv('BRILSTASH_SUPABASE_PROJECT_REF', 'liveproject');
    vi.stubEnv('BRILSTASH_FEED_ENV', 'live');
    expect((await GET(request())).status).toBe(503);
    expect(dependencies.rpc).not.toHaveBeenCalled();
  });

  it('treats a database ingress failure as an outage with a safe diagnostic', async () => {
    dependencies.abortSignal.mockResolvedValueOnce({
      data: { status: 'ingress_unavailable' },
      error: null,
    });
    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(dependencies.warn).toHaveBeenCalledWith({
      message: 'BrilStash database ingress verification failed',
      requestId: response.headers.get('x-request-id'),
    });
    expect(await response.json()).toEqual({
      error: 'Catalogue unavailable',
      code: 'FEED_UNAVAILABLE',
    });
  });

  it.each([
    [{ data: { status: 'unauthorized' }, error: null }, 401],
    [{ data: { status: 'invalid_query' }, error: null }, 400],
    [{ data: { status: 'unavailable' }, error: null }, 503],
    [{ data: { status: 'ok', products: [] }, error: null }, 503],
    [{ data: null, error: { message: 'database secret' } }, 503],
  ])('rejects unavailable or malformed database results without leaking error text', async (rpcResult, status) => {
    dependencies.abortSignal.mockResolvedValueOnce(rpcResult);
    const response = await GET(request());
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toContain('database secret');
  });

  it('preserves sandbox totals when the requested page is past the last row', async () => {
    dependencies.abortSignal.mockResolvedValueOnce({
      data: { ...result, products: [], totalCount: 1, totalPages: 1 },
      error: null,
    });
    const response = await GET(request('?page=2&limit=100'));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-total-count')).toBe('1');
    expect(response.headers.get('x-total-pages')).toBe('1');
    expect(await response.json()).toEqual([]);
  });

  it('returns a safe failure when the read exceeds the local deadline', async () => {
    vi.useFakeTimers();
    try {
      dependencies.abortSignal.mockReturnValueOnce(
        new Promise(() => undefined)
      );
      const pending = GET(request());
      await vi.advanceTimersByTimeAsync(8001);
      const response = await pending;
      expect(response.status).toBe(503);
      expect(dependencies.warn).toHaveBeenCalledWith({
        message: 'BrilStash feed read exceeded its deadline',
        requestId: response.headers.get('x-request-id'),
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('bugfix: the compile build rejects route segment config under cacheComponents', () => {
  it.each([
    'runtime',
    'dynamic',
    'revalidate',
    'fetchCache',
  ])('does not export the incompatible %s segment config', (name) => {
    expect(Object.keys(routeModule)).not.toContain(name);
  });
});
