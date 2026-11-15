/**
 * Simple in-memory cache with TTL
 * For production, consider using Redis or Upstash
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const MAX_CACHE_ENTRIES = 1000;
const LAZY_PRUNE_INTERVAL_MS = 60 * 1000;
const MIN_SIZE_PRUNE_COOLDOWN_MS = 1_000;
const PRUNE_BATCH_SIZE = 100;

class InMemoryCache {
  private cache: Map<string, CacheEntry<unknown>>;
  private lastPruneAt: number;

  constructor() {
    this.cache = new Map();
    this.lastPruneAt = Date.now();
  }

  /**
   * Lazily evict expired entries on write without module-level timers.
   * Size-triggered pruning is throttled and bounded to avoid full-map scans on every set().
   */
  private pruneExpired(now: number): void {
    const intervalElapsed = now - this.lastPruneAt >= LAZY_PRUNE_INTERVAL_MS;
    const sizeExceeded =
      this.cache.size >= MAX_CACHE_ENTRIES &&
      now - this.lastPruneAt >= MIN_SIZE_PRUNE_COOLDOWN_MS;
    if (!intervalElapsed && !sizeExceeded) {
      return;
    }
    this.lastPruneAt = now;
    let pruned = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        pruned++;
        if (!intervalElapsed && pruned >= PRUNE_BATCH_SIZE) break;
      }
    }
  }

  /**
   * Get cached data if it exists and hasn't expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Set data in cache with TTL in seconds
   */
  set<T>(key: string, data: T, ttlSeconds: number): void {
    const now = Date.now();
    this.pruneExpired(now);
    const expiresAt = now + ttlSeconds * 1000;
    this.cache.set(key, { data, expiresAt });
  }

  /**
   * Delete a specific cache entry
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Delete cache entries matching a pattern
   * Supports wildcards: * (matches any characters)
   * Uses simple string matching instead of regex to avoid ReDoS
   */
  deletePattern(pattern: string): void {
    // Simple wildcard matching without regex
    // Supports only trailing wildcards like "prefix*" or exact matches
    const isWildcard = pattern.endsWith('*');
    const prefix = isWildcard ? pattern.slice(0, -1) : pattern;

    for (const key of this.cache.keys()) {
      // Safety: skip extremely long keys
      if (key.length > 1000) continue;

      const shouldDelete = isWildcard
        ? key.startsWith(prefix) // Wildcard: match prefix
        : key === pattern; // Exact match

      if (shouldDelete) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Stop cleanup interval (no-op: eviction is now lazy on get/set)
   */
  stopCleanup(): void {
    // No-op: eviction is performed lazily on get/set without background timers.
  }
}

// Singleton instance
const cache = new InMemoryCache();

export { cache };

/**
 * Generate a cache key from multiple parts
 */
export function generateCacheKey(
  ...parts: (string | number | undefined)[]
): string {
  return parts.filter(Boolean).join(':');
}

/**
 * Cached function wrapper with automatic key generation
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>
): Promise<T> {
  // Try to get from cache
  const cached = cache.get<T>(key);
  if (cached !== null) {
    return cached;
  }

  // Fetch fresh data
  const data = await fetchFn();

  // Store in cache
  cache.set(key, data, ttlSeconds);

  return data;
}
