import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockGetRedis = vi.fn();

vi.mock('@/lib/cache', () => ({
  cache: {
    get: (...args: unknown[]) => mockCacheGet(...args),
    set: (...args: unknown[]) => mockCacheSet(...args),
  },
}));

vi.mock('@/lib/redis', () => ({
  getRedis: () => mockGetRedis(),
}));

import {
  type InsightsPayload,
  readCachedInsights,
  writeCachedInsights,
} from './insights-cache';

describe('insights-cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to in-memory cache when Redis is null', async () => {
    const payload: InsightsPayload = {
      insights: [
        { title: 'T', description: 'D', type: 'positive', priority: 'low' },
      ],
    };
    mockGetRedis.mockReturnValue(null);
    mockCacheGet.mockReturnValue(payload);

    await expect(readCachedInsights('k1')).resolves.toEqual(payload);
    await writeCachedInsights('k1', payload, 60);
    expect(mockCacheSet).toHaveBeenCalledWith('k1', payload, 60);
  });

  it('rejects malformed Redis payloads via schema validation', async () => {
    mockGetRedis.mockReturnValue({
      get: vi.fn().mockResolvedValue({ unexpected: true }),
    });
    mockCacheGet.mockReturnValue(null);

    await expect(readCachedInsights('k-bad')).resolves.toBeNull();
  });

  it('writes both local cache and Redis when Redis is configured', async () => {
    const payload: InsightsPayload = {
      insights: [
        { title: 'T', description: 'D', type: 'positive', priority: 'low' },
      ],
    };
    const redisSet = vi.fn().mockResolvedValue('OK');
    mockGetRedis.mockReturnValue({ set: redisSet });

    await writeCachedInsights('k2', payload, 120);
    expect(mockCacheSet).toHaveBeenCalledWith('k2', payload, 120);
    expect(redisSet).toHaveBeenCalledWith('k2', payload, { ex: 120 });
  });
});
