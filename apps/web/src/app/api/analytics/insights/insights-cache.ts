import { cache } from '@/lib/cache';
import { getRedis } from '@/lib/redis';

export interface InsightsPayload {
  insights: Array<{
    title: string;
    description: string;
    type: string;
    priority: string;
    action?: string;
  }>;
}

const REDIS_CACHE_TIMEOUT_MS = 750;

async function withRedisTimeout<T>(operation: Promise<T>): Promise<T> {
  // @upstash/redis commands do not accept an AbortSignal per call, so race
  // against a bounded timer to keep Redis stalls from exhausting the route.
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Redis cache timeout')),
          REDIS_CACHE_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export async function readCachedInsights(
  cacheKey: string
): Promise<InsightsPayload | null> {
  const redis = getRedis();
  if (!redis) {
    return cache.get<InsightsPayload>(cacheKey);
  }
  try {
    const cached = await withRedisTimeout(redis.get<InsightsPayload>(cacheKey));
    return cached ?? cache.get<InsightsPayload>(cacheKey);
  } catch (error) {
    console.warn('[analytics/insights] Redis cache read failed', error);
    return cache.get<InsightsPayload>(cacheKey);
  }
}

export async function writeCachedInsights(
  cacheKey: string,
  payload: InsightsPayload,
  ttlSeconds: number
): Promise<void> {
  cache.set(cacheKey, payload, ttlSeconds);
  const redis = getRedis();
  if (!redis) {
    return;
  }
  try {
    await withRedisTimeout(redis.set(cacheKey, payload, { ex: ttlSeconds }));
  } catch (error) {
    console.warn('[analytics/insights] Redis cache write failed', error);
  }
}
