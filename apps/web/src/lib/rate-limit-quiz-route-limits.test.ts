import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRateLimitStoreForTesting, checkRateLimit } from './rate-limit';

// No shared Redis: every check below counts in the in-memory store, so the
// reported limit is the route's own budget.
vi.mock('./redis', () => ({ getRedis: () => null }));

describe('quiz route rate limits through checkRateLimit', () => {
  beforeEach(() => {
    __resetRateLimitStoreForTesting();
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
    ['/api/quiz/attempts/attempt-1/answers', 120],
    ['/api/quiz/attempts/active', 60],
    ['/api/quiz/attempts/attempt-1/finalize-awards', 50],
  ])('gives answers and recovery their own limits and leaves the rest on the default: %s', async (path, expectedLimit) => {
    const result = await checkRateLimit(
      new NextRequest(`http://localhost:3000${path}`)
    );

    expect(result.limit).toBe(expectedLimit);
  });
});
