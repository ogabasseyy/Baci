// Upstash Redis client singleton
// Used for distributed rate limiting across Vercel serverless instances.
// Returns null when env vars are missing (dev without Redis, CI, etc.)
// so callers can fall back to in-memory alternatives.

import { Redis } from '@upstash/redis';

let redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (redis) return redis;

  // A separately connected resource lets production rotate the shared Redis
  // without overwriting write-only credentials. Never mix credential pairs.
  const replacementConfigured =
    process.env.BACI_RATE_LIMIT_KV_REST_API_URL !== undefined ||
    process.env.BACI_RATE_LIMIT_KV_REST_API_TOKEN !== undefined;
  const url = replacementConfigured
    ? process.env.BACI_RATE_LIMIT_KV_REST_API_URL
    : process.env.UPSTASH_REDIS_REST_URL;
  const token = replacementConfigured
    ? process.env.BACI_RATE_LIMIT_KV_REST_API_TOKEN
    : process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  redis = new Redis({ url, token });
  return redis;
}
