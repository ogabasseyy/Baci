import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetRateLimitStoreForTesting,
  checkImeiPollRateLimit,
  checkRateLimit,
  getTrustedClientIdentifier,
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

describe('legacy bridge rate limit keying', () => {
  beforeEach(() => {
    __resetRateLimitStoreForTesting();
    mockGetRedis.mockReturnValue(null);
  });

  afterEach(() => {
    __resetRateLimitStoreForTesting();
  });

  it('keys legacy bridge buckets by token, not the shared egress IP', async () => {
    const prefix = `Bearer ${['legacy', 'mcp'].join('_')}_`;
    const url = 'https://ogabassey.com/api/storefront/cart/legacy';
    const headersFor = (token: string) => ({
      authorization: `${prefix}${token}`,
      'x-real-ip': '192.0.2.20',
    });
    const first = await checkRateLimit(
      new NextRequest(url, {
        method: 'POST',
        headers: headersFor('a'.repeat(64)),
      })
    );
    const second = await checkRateLimit(
      new NextRequest(url, {
        method: 'POST',
        headers: headersFor('a'.repeat(64)),
      })
    );
    const otherToken = await checkRateLimit(
      new NextRequest(url, {
        method: 'POST',
        headers: headersFor('b'.repeat(64)),
      })
    );

    expect(first.limit).toBe(600);
    expect(second.remaining).toBe(598);
    // A different token behind the same IP gets its own bucket.
    expect(otherToken.remaining).toBe(599);
  });
});

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

describe('getTrustedClientIdentifier (cart quota identity)', () => {
  function requestWith(headers: Record<string, string>): NextRequest {
    return new NextRequest('http://localhost:3000/api/storefront/cart', {
      headers,
    });
  }

  it('never lets a rotating x-forwarded-for reset the quota subject', () => {
    // Every spoofed value must land in the same shared bucket, so the
    // anonymous cart budgets cannot be reset by header rotation.
    expect(
      getTrustedClientIdentifier(
        requestWith({ 'x-forwarded-for': '203.0.113.1' })
      )
    ).toBe('unknown');
    expect(
      getTrustedClientIdentifier(
        requestWith({ 'x-forwarded-for': '198.51.100.9, 203.0.113.1' })
      )
    ).toBe('unknown');
    expect(
      getTrustedClientIdentifier(requestWith({ 'x-forwarded-for': 'x' }))
    ).toBe('unknown');
  });

  it('uses the platform-set x-real-ip when present', () => {
    expect(
      getTrustedClientIdentifier(
        requestWith({
          'x-forwarded-for': '203.0.113.1',
          'x-real-ip': '192.0.2.44',
        })
      )
    ).toBe('192.0.2.44');
  });

  it('ignores a malformed x-real-ip', () => {
    expect(
      getTrustedClientIdentifier(requestWith({ 'x-real-ip': 'not-an-ip' }))
    ).toBe('unknown');
  });
});
