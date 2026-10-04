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

const mockWarn = vi.hoisted(() => vi.fn());
vi.mock('./logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: (...args: unknown[]) => mockWarn(...args),
  },
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
    ).resolves.toBe('allowed');
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
    ).resolves.toBe('denied');
  });

  it('fails closed when Redis is unavailable or errors', async () => {
    mockGetRedis.mockReturnValueOnce(null);
    await expect(
      checkTenantRateLimit('search_assist', 'm1', {
        maxRequests: 60,
        windowMs: 60_000,
      })
    ).resolves.toBe('unavailable');
    expect(mockLimiterLimit).not.toHaveBeenCalled();
    mockLimiterLimit.mockRejectedValueOnce(new Error('redis down'));
    await expect(
      checkTenantRateLimit('search_assist', 'm1', {
        maxRequests: 60,
        windowMs: 60_000,
      })
    ).resolves.toBe('unavailable');
  });

  it('pages once per outage instead of warning per denied request', async () => {
    vi.resetModules();
    mockWarn.mockClear();
    mockGetRedis.mockReturnValue(null);
    const { checkTenantRateLimit: freshCheck } = await import(
      './tenant-rate-limit'
    );
    const config = { maxRequests: 60, windowMs: 60_000 };
    await freshCheck('search_assist', 'm1', config);
    await freshCheck('search_assist', 'm1', config);
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'search_assist', tenantId: 'm1' })
    );
  });
});
