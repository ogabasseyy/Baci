import type { RateLimitConfig, RateLimitResult } from './rate-limit';

// ---------------------------------------------------------------------------
// In-memory fallback (when Redis is unavailable)
// ---------------------------------------------------------------------------

const memoryStore = new Map<string, { count: number; resetTime: number }>();
const MAX_STORE_SIZE = 10_000;
const PRUNE_BATCH_SIZE = 100;

function pruneStore(now: number): void {
  if (memoryStore.size < MAX_STORE_SIZE) return;
  let pruned = 0;
  for (const [key, entry] of memoryStore) {
    if (now > entry.resetTime) {
      memoryStore.delete(key);
      pruned++;
      if (pruned >= PRUNE_BATCH_SIZE) break;
    }
  }
}

export function checkMemoryRateLimit(
  identifier: string,
  pattern: string,
  config: RateLimitConfig
): RateLimitResult {
  const key = `${identifier}:${pattern}`;
  const now = Date.now();
  pruneStore(now);

  let entry = memoryStore.get(key);
  if (!entry || now > entry.resetTime) {
    entry = { count: 0, resetTime: now + config.windowMs };
  }

  entry.count++;
  memoryStore.set(key, entry);

  const allowed = entry.count <= config.maxRequests;
  const remaining = Math.max(0, config.maxRequests - entry.count);

  return {
    allowed,
    limit: config.maxRequests,
    remaining,
    resetTime: entry.resetTime,
  };
}

// ---------------------------------------------------------------------------
// Cleanup (in-memory fallback only)
// ---------------------------------------------------------------------------

export function cleanupRateLimitStore(): void {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (now > entry.resetTime) {
      memoryStore.delete(key);
    }
  }
}

if (typeof setInterval !== 'undefined') {
  setInterval(cleanupRateLimitStore, 5 * 60 * 1000);
}

export function resetMemoryRateLimitStore(): void {
  memoryStore.clear();
}
