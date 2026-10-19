import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkMemoryRateLimit,
  cleanupRateLimitStore,
  resetMemoryRateLimitStore,
} from './rate-limit-memory';

describe('in-memory rate-limit fallback', () => {
  afterEach(() => {
    resetMemoryRateLimitStore();
    vi.useRealTimers();
  });

  it('allows up to the ceiling, then denies with zero remaining', () => {
    const config = { maxRequests: 2, windowMs: 60_000 };

    expect(checkMemoryRateLimit('ip-1', '/api/x', config)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(checkMemoryRateLimit('ip-1', '/api/x', config)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(checkMemoryRateLimit('ip-1', '/api/x', config)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
    // Other identifiers keep their own budget.
    expect(checkMemoryRateLimit('ip-2', '/api/x', config).allowed).toBe(true);
  });

  it('resets the bucket once the window elapses', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const config = { maxRequests: 1, windowMs: 60_000 };

    expect(checkMemoryRateLimit('ip-1', '/api/x', config).allowed).toBe(true);
    expect(checkMemoryRateLimit('ip-1', '/api/x', config).allowed).toBe(false);
    vi.setSystemTime(1_000_000 + 60_001);
    expect(checkMemoryRateLimit('ip-1', '/api/x', config)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
  });

  it('cleans up expired entries without touching live ones', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const config = { maxRequests: 1, windowMs: 60_000 };

    checkMemoryRateLimit('expired', '/api/x', config);
    vi.setSystemTime(1_000_000 + 30_000);
    checkMemoryRateLimit('live', '/api/x', config);
    vi.setSystemTime(1_000_000 + 61_000);
    cleanupRateLimitStore();

    // Expired bucket restarts at zero; live bucket still denies.
    expect(checkMemoryRateLimit('expired', '/api/x', config).allowed).toBe(
      true
    );
    expect(checkMemoryRateLimit('live', '/api/x', config).allowed).toBe(false);
  });
});
