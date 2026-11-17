import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRateLimitStoreForTesting, checkRateLimit } from './rate-limit';

const mockLimiterLimit = vi.hoisted(() => vi.fn());
const mockRatelimit = vi.hoisted(() => {
  const ratelimitClass = vi.fn(function mockRatelimitConstructor() {
    return { limit: mockLimiterLimit };
  });
  return Object.assign(ratelimitClass, {
    fixedWindow: vi.fn(() => 'fixed-window'),
    slidingWindow: vi.fn(() => 'sliding-window'),
  });
});

vi.mock('@upstash/ratelimit', () => ({ Ratelimit: mockRatelimit }));
vi.mock('./redis', () => ({ getRedis: () => ({}) }));

const TOKEN = `${'a'.repeat(20)}.${'b'.repeat(40)}.${'c'.repeat(43)}`;

function request(pathname: string, authorization?: string) {
  return new NextRequest(`https://usebaci.com${pathname}`, {
    headers: {
      'x-real-ip': '203.0.113.7',
      ...(authorization ? { authorization } : {}),
    },
  });
}

describe('checkRateLimit for the quiz app API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitStoreForTesting();
    mockLimiterLimit.mockResolvedValue({
      success: true,
      limit: 120,
      remaining: 119,
      reset: 0,
    });
  });

  it('charges an app request to the player, with the fixed-window counter', async () => {
    const result = await checkRateLimit(
      request('/api/quiz/attempts/attempt-1/answers', `Bearer ${TOKEN}`)
    );

    expect(result.allowed).toBe(true);
    expect(mockRatelimit.fixedWindow).toHaveBeenCalledWith(120, '60 s');
    expect(mockRatelimit.slidingWindow).not.toHaveBeenCalled();
    const [key] = mockLimiterLimit.mock.calls[0];
    expect(key).toMatch(
      /^quiz-player:[a-f0-9]{64}:\/api\/quiz\/attempts\/:attemptId\/answers$/
    );
    expect(key).not.toContain('203.0.113.7');
  });

  it('keeps a browser session on the per-address sliding window', async () => {
    await checkRateLimit(request('/api/quiz/leaderboard/live'));

    expect(mockRatelimit.slidingWindow).toHaveBeenCalledWith(120, '60 s');
    expect(mockRatelimit.fixedWindow).not.toHaveBeenCalled();
    const [key] = mockLimiterLimit.mock.calls[0];
    expect(key).toBe('203.0.113.7:/api/quiz/leaderboard');
  });

  it('does not change the bucket of a non-quiz route that carries a bearer token', async () => {
    await checkRateLimit(
      request('/api/storefront/products', `Bearer ${TOKEN}`)
    );

    expect(mockRatelimit.fixedWindow).not.toHaveBeenCalled();
    const [key] = mockLimiterLimit.mock.calls[0];
    expect(key).toBe('203.0.113.7:/api/storefront');
  });
});
