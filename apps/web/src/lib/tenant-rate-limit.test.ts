import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkTenantRateLimit } from './tenant-rate-limit';

const mockGetRedis = vi.hoisted(() => vi.fn<() => object | null>(() => ({})));
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

describe('checkTenantRateLimit', () => {
  beforeEach(() => {
    mockGetRedis.mockReturnValue({});
    mockLimiterLimit.mockReset();
    mockLimiterLimit.mockResolvedValue({ success: true });
  });

  it('charges the namespaced tenant key against a sliding window', async () => {
    await expect(
      checkTenantRateLimit('search_assist', 'm1', {
        maxRequests: 60,
        windowMs: 60_000,
      })
    ).resolves.toBe(true);
    expect(mockLimiterLimit).toHaveBeenCalledWith('search_assist:m1');
    expect(mockRatelimitConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: 'baci:tenant-ratelimit' })
    );
  });

  it('denies when the budget is exhausted', async () => {
    mockLimiterLimit.mockResolvedValue({ success: false });
    await expect(
      checkTenantRateLimit('search_assist', 'm1', {
        maxRequests: 60,
        windowMs: 60_000,
      })
    ).resolves.toBe(false);
  });

  it('fails closed when Redis is unavailable or errors', async () => {
    mockGetRedis.mockReturnValueOnce(null);
    await expect(
      checkTenantRateLimit('search_assist', 'm1', {
        maxRequests: 60,
        windowMs: 60_000,
      })
    ).resolves.toBe(false);
    expect(mockLimiterLimit).not.toHaveBeenCalled();
    mockLimiterLimit.mockRejectedValueOnce(new Error('redis down'));
    await expect(
      checkTenantRateLimit('search_assist', 'm1', {
        maxRequests: 60,
        windowMs: 60_000,
      })
    ).resolves.toBe(false);
  });
});
