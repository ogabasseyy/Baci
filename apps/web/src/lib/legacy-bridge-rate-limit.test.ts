import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { checkLegacyBridgeRateLimit } from './legacy-bridge-rate-limit';
import type { RateLimitConfig, RateLimitResult } from './rate-limit';

const CONFIG: RateLimitConfig = { maxRequests: 600, windowMs: 60_000 };
const URL_ = 'https://ogabassey.com/api/storefront/cart/legacy';
const prefix = `Bearer ${['legacy', 'mcp'].join('_')}_`;

function applyWith(behavior: (id: string) => RateLimitResult) {
  return vi.fn(async (identifier: string) => behavior(identifier));
}

const allowed = (limit: number): RateLimitResult => ({
  allowed: true,
  limit,
  remaining: limit - 1,
  resetTime: Date.now() + 60_000,
});
const blocked = (limit: number): RateLimitResult => ({
  allowed: false,
  limit,
  remaining: 0,
  resetTime: Date.now() + 60_000,
});

function request(token?: string) {
  return new NextRequest(URL_, {
    method: 'POST',
    headers: token ? { authorization: `${prefix}${token}` } : {},
  });
}

describe('checkLegacyBridgeRateLimit', () => {
  it('checks the IP ceiling first and blocks without allocating a token bucket', async () => {
    const apply = applyWith((id) =>
      id.endsWith(':ip-ceiling') || !id.startsWith('legacy-token:')
        ? blocked(3_000)
        : allowed(600)
    );
    const result = await checkLegacyBridgeRateLimit(
      request('a'.repeat(64)),
      '/api/storefront/cart/legacy',
      CONFIG,
      'ip-1',
      apply
    );
    expect(result).toMatchObject({ allowed: false, limit: 3_000 });
    // Only the IP ceiling call happened: no token bucket allocated.
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(
      'ip-1',
      '/api/storefront/cart/legacy:ip-ceiling',
      expect.anything()
    );
  });

  it('keys the token bucket by token hash, never the raw token', async () => {
    const apply = applyWith(() => allowed(600));
    const result = await checkLegacyBridgeRateLimit(
      request('a'.repeat(64)),
      '/api/storefront/cart/legacy',
      CONFIG,
      'ip-1',
      apply
    );
    expect(result).toMatchObject({ allowed: true, limit: 600 });
    const tokenCall = apply.mock.calls.find(([id]) =>
      id.startsWith('legacy-token:')
    );
    expect(tokenCall?.[0]).toMatch(/^legacy-token:[a-f0-9]{64}$/);
    expect(tokenCall?.[0]).not.toContain('a'.repeat(64));
  });

  it('falls back to the IP bucket result for malformed callers', async () => {
    const apply = applyWith(() => allowed(3_000));
    const result = await checkLegacyBridgeRateLimit(
      request(),
      '/api/storefront/cart/legacy',
      CONFIG,
      'ip-9',
      apply
    );
    expect(result).toMatchObject({ allowed: true, limit: 3_000 });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('surfaces token-bucket exhaustion after the IP ceiling passes', async () => {
    const apply = applyWith((id) =>
      id.startsWith('legacy-token:') ? blocked(600) : allowed(3_000)
    );
    const result = await checkLegacyBridgeRateLimit(
      request('b'.repeat(64)),
      '/api/storefront/cart/legacy',
      CONFIG,
      'ip-1',
      apply
    );
    expect(result).toMatchObject({ allowed: false, limit: 600 });
  });
});
