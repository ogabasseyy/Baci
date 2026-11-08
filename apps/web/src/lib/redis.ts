// Upstash Redis client singleton
// Used for distributed rate limiting across Vercel serverless instances.
// Returns null when env vars are missing (dev without Redis, CI, etc.)
// so callers can fall back to in-memory alternatives.

import { Redis } from '@upstash/redis';

let redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (redis) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  redis = new Redis({ url, token });
  return redis;
}
