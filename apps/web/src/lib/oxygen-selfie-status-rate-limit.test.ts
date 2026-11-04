import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const shared = vi.hoisted(() => ({
  counts: new Map<string, number>(),
  redis: true,
  fail: false,
  timeout: false,
}));
vi.mock('./redis', () => ({ getRedis: () => (shared.redis ? {} : null) }));
vi.mock('@upstash/ratelimit', () => {
  const Ratelimit = class {
    max: number;
    constructor(config: { limiter: number }) {
      this.max = config.limiter;
    }
    static slidingWindow(max: number) {
      return max;
    }
    async limit(key: string) {
      if (shared.fail) throw new Error('redis unavailable');
      if (shared.timeout)
        return {
          success: true,
          limit: 0,
          remaining: 0,
          reset: 0,
          reason: 'timeout',
        };
      const count = (shared.counts.get(key) ?? 0) + 1;
      shared.counts.set(key, count);
      return {
        success: count <= this.max,
        limit: this.max,
        remaining: Math.max(0, this.max - count),
        reset: 1,
      };
    }
  };
  return { Ratelimit };
});
beforeEach(() => {
  vi.resetModules();
  shared.counts.clear();
  shared.redis = true;
  shared.fail = false;
  shared.timeout = false;
});
it('shares the six-read budget across independently loaded instances', async () => {
  const first = await import('./rate-limit');
  for (let i = 0; i < 3; i++)
    expect(
      (
        await first.checkOxygenProviderRateLimit(
          'user:workflow',
          'selfie-status',
          6
        )
      ).allowed
    ).toBe(true);
  vi.resetModules();
  const second = await import('./rate-limit');
  for (let i = 0; i < 3; i++)
    expect(
      (
        await second.checkOxygenProviderRateLimit(
          'user:workflow',
          'selfie-status',
          6
        )
      ).allowed
    ).toBe(true);
  expect(
    (
      await second.checkOxygenProviderRateLimit(
        'user:workflow',
        'selfie-status',
        6
      )
    ).allowed
  ).toBe(false);
  expect(
    (
      await second.checkOxygenProviderRateLimit(
        'user:other-workflow',
        'selfie-status',
        6
      )
    ).allowed
  ).toBe(true);
});
it('limits aggregate reads even as the user switches workflows', async () => {
  const { checkOxygenProviderRateLimit } = await import('./rate-limit');
  for (let i = 0; i < 12; i++) {
    expect(
      (await checkOxygenProviderRateLimit('user', 'selfie-status-user', 12))
        .allowed
    ).toBe(true);
    expect(
      (
        await checkOxygenProviderRateLimit(
          `user:workflow-${i}`,
          'selfie-status',
          6
        )
      ).allowed
    ).toBe(true);
  }
  expect(
    (await checkOxygenProviderRateLimit('user', 'selfie-status-user', 12))
      .allowed
  ).toBe(false);
});
it('denies the read when Redis is missing or fails', async () => {
  const { checkOxygenProviderRateLimit } = await import('./rate-limit');
  shared.redis = false;
  expect(
    (await checkOxygenProviderRateLimit('user:workflow', 'selfie-status', 6))
      .allowed
  ).toBe(false);
  shared.redis = true;
  shared.fail = true;
  expect(
    (await checkOxygenProviderRateLimit('user:workflow', 'selfie-status', 6))
      .allowed
  ).toBe(false);
  shared.fail = false;
  shared.timeout = true;
  expect(
    (await checkOxygenProviderRateLimit('user:workflow', 'selfie-status', 6))
      .allowed
  ).toBe(false);
});
it('preserves timeout behavior for rate limits that do not opt into fail-closed mode', async () => {
  shared.timeout = true;
  const { checkRateLimit } = await import('./rate-limit');
  expect(
    (await checkRateLimit(new NextRequest('https://example.test/api/ordinary')))
      .allowed
  ).toBe(true);
});
