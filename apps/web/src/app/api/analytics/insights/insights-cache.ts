import { cache } from '@/lib/cache';
import { getRedis } from '@/lib/redis';
import {
  type AnalyticsInsights,
  analyticsInsightsSchema,
} from '@/schemas/analytics-insights';

export type InsightsPayload = AnalyticsInsights;

const REDIS_CACHE_TIMEOUT_MS = 750;
const REDIS_COOLDOWN_MS = 30_000;
let redisCooldownUntil = 0;

function parseCachedInsights(value: unknown): InsightsPayload | null {
  if (!value) return null;
  const parsed = analyticsInsightsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function withRedisTimeout<T>(operation: Promise<T>): Promise<T> {
  // @upstash/redis commands do not accept an AbortSignal per call, so race
  // against a bounded timer and swallow late rejections from the losing promise.
  operation.catch(() => undefined);
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
  const redis = Date.now() < redisCooldownUntil ? null : getRedis();
  if (!redis) {
    return parseCachedInsights(cache.get<InsightsPayload>(cacheKey));
  }
  try {
    const cached = await withRedisTimeout(redis.get<InsightsPayload>(cacheKey));
    return (
      parseCachedInsights(cached) ??
      parseCachedInsights(cache.get<InsightsPayload>(cacheKey))
    );
  } catch (error) {
    redisCooldownUntil = Date.now() + REDIS_COOLDOWN_MS;
    console.warn('[analytics/insights] Redis cache read failed', error);
    return parseCachedInsights(cache.get<InsightsPayload>(cacheKey));
  }
}

export async function writeCachedInsights(
  cacheKey: string,
  payload: InsightsPayload,
  ttlSeconds: number
): Promise<void> {
  cache.set(cacheKey, payload, ttlSeconds);
  const redis = Date.now() < redisCooldownUntil ? null : getRedis();
  if (!redis) {
    return;
  }
  try {
    await withRedisTimeout(redis.set(cacheKey, payload, { ex: ttlSeconds }));
  } catch (error) {
    redisCooldownUntil = Date.now() + REDIS_COOLDOWN_MS;
    console.warn('[analytics/insights] Redis cache write failed', error);
  }
}

export async function deleteCachedInsights(cacheKey: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    return true;
  }
  try {
    await withRedisTimeout(redis.del(cacheKey));
    return true;
  } catch (error) {
    console.warn('[analytics/insights] Redis cache delete failed', error);
    return false;
  }
}
