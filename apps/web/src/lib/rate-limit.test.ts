import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetRateLimitStoreForTesting,
  checkImeiPollRateLimit,
  checkRateLimit,
  setRateLimitDiagnosticHook,
} from './rate-limit';

const mockGetRedis = vi.hoisted(() => vi.fn<() => object | null>(() => null));
const mockLimiterLimit = vi.hoisted(() => vi.fn());
const mockRatelimitConstructor = vi.hoisted(() => {
  const ratelimitClass = vi.fn(function mockRatelimitConstructor() {
    return { limit: mockLimiterLimit };
  });
  return Object.assign(ratelimitClass, {
    slidingWindow: vi.fn(() => 'mock-window'),
  });
});

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: mockRatelimitConstructor,
}));

vi.mock('./redis', () => ({
  getRedis: mockGetRedis,
}));

// Dedicated coverage for the quiz-specific rate-limit entries added for launch.
// The broader per-IP identifier / trie behavior is covered in rate-limit.test.tsx.
describe('quiz route rate limits', () => {
  beforeEach(() => {
    __resetRateLimitStoreForTesting();
    mockGetRedis.mockReturnValue(null);
    mockLimiterLimit.mockReset();
    mockRatelimitConstructor.mockClear();
  });

  afterEach(() => {
    __resetRateLimitStoreForTesting();
  });

  it.each([
    ['/api/merchant/quiz/generate', 5],
    ['/api/quiz/attempts/start', 20],
    ['/api/quiz/awards/cash/claim', 10],
    ['/api/quiz/prizes/grand/claim', 10],
  ])('applies a dedicated limit to %s', async (path, expectedLimit) => {
    const result = await checkRateLimit(
      new NextRequest(`http://localhost:3000${path}`)
    );

    expect(result.limit).toBe(expectedLimit);
  });

  it.each([
    ['/api/quiz/attempts/attempt-1/answers', 50],
    ['/api/quiz/attempts/active', 50],
    ['/api/quiz/attempts/attempt-1/finalize-awards', 50],
  ])('keeps non-polling attempt routes on the default limit: %s', async (path, expectedLimit) => {
    const result = await checkRateLimit(
      new NextRequest(`http://localhost:3000${path}`)
    );

    expect(result.limit).toBe(expectedLimit);
  });

  it('throttles submission writes without consuming the autocomplete budget and recovers after the window', async () => {
    vi.useFakeTimers();
    try {
      const request = new NextRequest(
        'https://ogabassey.com/api/search/submissions',
        { method: 'POST', headers: { 'x-real-ip': '192.0.2.10' } }
      );
      for (let index = 0; index < 20; index += 1) {
        expect((await checkRateLimit(request)).allowed).toBe(true);
      }
      const blocked = await checkRateLimit(request);
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
      expect(
        (
          await checkRateLimit(
            new NextRequest('https://ogabassey.com/api/search/autocomplete', {
              headers: { 'x-real-ip': '192.0.2.10' },
            })
          )
        ).allowed
      ).toBe(true);
      vi.advanceTimersByTime(60_001);
      expect((await checkRateLimit(request)).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocks the expensive generate route after its 5-request budget', async () => {
    const url = 'http://localhost:3000/api/merchant/quiz/generate';

    for (let i = 0; i < 5; i += 1) {
      const allowed = await checkRateLimit(new NextRequest(url));
      expect(allowed.allowed).toBe(true);
    }

    const blocked = await checkRateLimit(new NextRequest(url));
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('buckets an alias-shaped path by the normalized override pathname', async () => {
    const request = new NextRequest(
      'http://localhost:3000/old-slug/api/storefront/product-requests'
    );
    // The raw alias path matches no endpoint pattern (generic default);
    // the proxy passes the normalized endpoint pathname instead.
    await expect(checkRateLimit(request)).resolves.toMatchObject({
      limit: 50,
    });
    __resetRateLimitStoreForTesting();
    await expect(
      checkRateLimit(request, '/api/storefront/product-requests')
    ).resolves.toMatchObject({ limit: 10 });
  });

  it('does not apply a quiz limit to unrelated routes (default fall-through)', async () => {
    const result = await checkRateLimit(
      new NextRequest('http://localhost:3000/api/unknown')
    );

    // The four quiz limits (5/10/20) must not leak onto unmatched paths.
    expect([5, 10, 20]).not.toContain(result.limit);
  });

  it('gives IMEI status polling a separate high-frequency bucket', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/storefront/imei-check/11111111-1111-4111-8111-111111111111'
    );

    for (let index = 0; index < 120; index += 1) {
      await expect(checkImeiPollRateLimit(request)).resolves.toMatchObject({
        allowed: true,
        limit: 120,
      });
    }

    await expect(checkImeiPollRateLimit(request)).resolves.toMatchObject({
      allowed: false,
      limit: 120,
      remaining: 0,
    });
  });

  it('reports an unconfigured Redis fallback with fixed-cardinality diagnostics', async () => {
    const diagnostics: unknown[] = [];
    setRateLimitDiagnosticHook((diagnostic) => diagnostics.push(diagnostic));

    const result = await checkRateLimit(
      new NextRequest('http://localhost:3000/api/unknown')
    );

    expect(result.allowed).toBe(true);
    expect(diagnostics).toEqual([
      { backend: 'memory', reason: 'redis_unavailable' },
    ]);
  });

  it('reports a successful Redis rate-limit check with fixed-cardinality diagnostics', async () => {
    mockGetRedis.mockReturnValue({});
    mockLimiterLimit.mockResolvedValue({
      limit: 50,
      remaining: 49,
      reset: 123_456,
      success: true,
    });
    const diagnostics: unknown[] = [];
    setRateLimitDiagnosticHook((diagnostic) => diagnostics.push(diagnostic));

    const result = await checkRateLimit(
      new NextRequest('http://localhost:3000/api/unknown')
    );

    expect(result).toEqual({
      allowed: true,
      limit: 50,
      remaining: 49,
      resetTime: 123_456,
    });
    expect(diagnostics).toEqual([
      { backend: 'redis', reason: 'redis_success' },
    ]);
  });

  it('reports a Redis error before preserving the in-memory fallback result', async () => {
    mockGetRedis.mockReturnValue({});
    mockLimiterLimit.mockRejectedValue(new Error('Redis unavailable'));
    const diagnostics: unknown[] = [];
    setRateLimitDiagnosticHook((diagnostic) => diagnostics.push(diagnostic));

    const result = await checkRateLimit(
      new NextRequest('http://localhost:3000/api/unknown')
    );

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(50);
    expect(diagnostics).toEqual([{ backend: 'memory', reason: 'redis_error' }]);
  });

  it('ignores diagnostic sink failures and preserves the rate-limit result', async () => {
    setRateLimitDiagnosticHook(() => {
      throw new Error('diagnostic sink unavailable');
    });

    await expect(
      checkRateLimit(new NextRequest('http://localhost:3000/api/unknown'))
    ).resolves.toMatchObject({ allowed: true });
  });
});
