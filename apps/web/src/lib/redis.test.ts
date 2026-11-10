import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @upstash/redis
const mockRedisInstance = { get: vi.fn(), set: vi.fn() };
vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(function (this: any) {
    return mockRedisInstance;
  }),
}));

describe('getRedis', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.BACI_RATE_LIMIT_KV_REST_API_URL;
    delete process.env.BACI_RATE_LIMIT_KV_REST_API_TOKEN;
  });

  it('returns null when env vars are missing', async () => {
    const { getRedis } = await import('./redis');
    expect(getRedis()).toBeNull();
  });

  it('returns null when only URL is set', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://test.upstash.io';
    const { getRedis } = await import('./redis');
    expect(getRedis()).toBeNull();
  });

  it('returns null when only token is set', async () => {
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    const { getRedis } = await import('./redis');
    expect(getRedis()).toBeNull();
  });

  it('returns Redis instance when both env vars are set', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://test.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    const { getRedis } = await import('./redis');
    const redis = getRedis();
    expect(redis).not.toBeNull();
  });

  it('uses the replacement resource when both configurations exist', async () => {
    const { Redis } = await import('@upstash/redis');
    process.env.UPSTASH_REDIS_REST_URL = 'https://old.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'old-token';
    process.env.BACI_RATE_LIMIT_KV_REST_API_URL = 'https://new.upstash.io';
    process.env.BACI_RATE_LIMIT_KV_REST_API_TOKEN = 'new-token';
    const { getRedis } = await import('./redis');
    getRedis();
    expect(Redis).toHaveBeenLastCalledWith({
      url: 'https://new.upstash.io',
      token: 'new-token',
    });
  });

  it('does not combine an incomplete replacement with old credentials', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://old.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'old-token';
    process.env.BACI_RATE_LIMIT_KV_REST_API_URL = 'https://new.upstash.io';
    const { getRedis } = await import('./redis');
    expect(getRedis()).toBeNull();
  });

  it('returns the same instance on subsequent calls (singleton)', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://test.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    const { getRedis } = await import('./redis');
    const first = getRedis();
    const second = getRedis();
    expect(first).toBe(second);
  });
});
