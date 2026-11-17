import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkQuizPlayerRateLimit,
  isQuizPlayerPath,
} from './quiz-player-rate-limit';
import type { RateLimitConfig, RateLimitResult } from './rate-limit';
import { resetMemoryRateLimitStore } from './rate-limit-memory';

const CONFIG: RateLimitConfig = { maxRequests: 120, windowMs: 60_000 };
const PATTERN = '/api/quiz/leaderboard';
const URL_ = 'https://usebaci.com/api/quiz/leaderboard/live?eventId=1';
// Shaped like an access token; the value is never verified here.
const TOKEN_A = `${'a'.repeat(20)}.${'b'.repeat(40)}.${'c'.repeat(43)}`;
const TOKEN_B = `${'d'.repeat(20)}.${'e'.repeat(40)}.${'f'.repeat(43)}`;

const allowed: RateLimitResult = {
  allowed: true,
  limit: 120,
  remaining: 119,
  resetTime: 0,
};

function request(authorization?: string) {
  return new NextRequest(URL_, {
    headers: authorization ? { authorization } : {},
  });
}

function apply() {
  return vi.fn(
    (_identifier: string, _pattern: string, _config: RateLimitConfig) =>
      Promise.resolve(allowed)
  );
}

describe('checkQuizPlayerRateLimit', () => {
  beforeEach(() => resetMemoryRateLimitStore());

  it('charges a signed-in player their own bucket, keyed by a token hash', async () => {
    const applyRateLimit = apply();
    const result = await checkQuizPlayerRateLimit(
      request(`Bearer ${TOKEN_A}`),
      PATTERN,
      CONFIG,
      'shared-carrier-address',
      applyRateLimit
    );

    expect(result).toEqual(allowed);
    expect(applyRateLimit).toHaveBeenCalledTimes(1);
    const [identifier, pattern, config] = applyRateLimit.mock.calls[0];
    expect(identifier).toMatch(/^quiz-player:[a-f0-9]{64}$/);
    expect(identifier).not.toContain(TOKEN_A);
    expect(identifier).not.toContain('shared-carrier-address');
    expect(pattern).toBe(PATTERN);
    // Same budget, cheaper counter.
    expect(config).toEqual({ ...CONFIG, fixedWindow: true });
  });

  it('gives two players behind one address separate buckets', async () => {
    const applyRateLimit = apply();
    await checkQuizPlayerRateLimit(
      request(`Bearer ${TOKEN_A}`),
      PATTERN,
      CONFIG,
      'shared-carrier-address',
      applyRateLimit
    );
    await checkQuizPlayerRateLimit(
      request(`bearer ${TOKEN_B}`),
      PATTERN,
      CONFIG,
      'shared-carrier-address',
      applyRateLimit
    );

    const [first, second] = applyRateLimit.mock.calls.map(([id]) => id);
    expect(first).not.toBe(second);
  });

  it.each([
    ['no Authorization header', undefined],
    ['a non-bearer scheme', `Basic ${TOKEN_A}`],
    ['a bearer value that is not token shaped', 'Bearer not-a-token'],
    ['an empty bearer value', 'Bearer '],
  ])('leaves %s to the per-address bucket', async (_label, authorization) => {
    const applyRateLimit = apply();
    const result = await checkQuizPlayerRateLimit(
      request(authorization),
      PATTERN,
      CONFIG,
      'address-1',
      applyRateLimit
    );

    expect(result).toBeNull();
    expect(applyRateLimit).not.toHaveBeenCalled();
  });

  it('stops one address that rotates made-up tokens, without a bucket per token', async () => {
    const applyRateLimit = apply();
    let blocked: RateLimitResult | null = null;
    for (let index = 0; index < 6_001; index += 1) {
      const token = `${'a'.repeat(20)}.${String(index).padStart(40, '0')}.${'c'.repeat(43)}`;
      blocked = await checkQuizPlayerRateLimit(
        request(`Bearer ${token}`),
        PATTERN,
        CONFIG,
        'flooding-address',
        applyRateLimit
      );
    }

    expect(blocked).toMatchObject({ allowed: false, limit: 6_000 });
    // The 6,001st request never reached a player bucket.
    expect(applyRateLimit).toHaveBeenCalledTimes(6_000);

    // Another address is unaffected.
    const other = await checkQuizPlayerRateLimit(
      request(`Bearer ${TOKEN_A}`),
      PATTERN,
      CONFIG,
      'another-address',
      applyRateLimit
    );
    expect(other).toEqual(allowed);
  });
});

describe('isQuizPlayerPath', () => {
  it.each([
    ['/api/quiz', true],
    ['/api/quiz/leaderboard/live', true],
    ['/api/quiz/attempts/abc/answers', true],
    ['/api/quizzes', false],
    ['/api/merchant/quiz/generate', false],
    ['/api/storefront/auth/send-code', false],
  ])('%s -> %s', (pathname, expected) => {
    expect(isQuizPlayerPath(pathname)).toBe(expected);
  });
});
