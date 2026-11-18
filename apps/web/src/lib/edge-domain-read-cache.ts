import type { SingleFlight } from './single-flight';

export interface EdgeDomainReadCacheOptions {
  maxEntries: number;
  positiveTtlMs: number;
  negativeTtlMs: number;
}

export type EdgeDomainReadCacheResult =
  | { hit: true; value: string }
  | { hit: true; value: undefined }
  | { hit: false };

function setBoundedEntry<V>(
  map: Map<string, V>,
  key: string,
  value: V,
  maxEntries: number
): void {
  if (map.has(key)) {
    map.delete(key);
  } else if (map.size >= maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) {
      map.delete(oldestKey);
    }
  }
  map.set(key, value);
}

/**
 * Bounded in-memory cache for Vercel Edge Config domain lookups.
 * Keeps positive and negative entries in separate bounded maps so bursts of
 * unmapped host/slug misses cannot evict active positive custom-domain entries.
 */
export function createWarmEdgeDomainReadCache(
  options: EdgeDomainReadCacheOptions
) {
  const positiveEntries = new Map<
    string,
    { value: string; writtenAt: number }
  >();
  const negativeEntries = new Map<string, number>();

  return {
    clear(): void {
      positiveEntries.clear();
      negativeEntries.clear();
    },
    clearNegativeEntries(): void {
      negativeEntries.clear();
    },
    deleteKey(key: string): void {
      positiveEntries.delete(key);
      negativeEntries.delete(key);
    },
    deleteValue(value: string): void {
      for (const [key, entry] of positiveEntries) {
        if (entry.value === value) {
          positiveEntries.delete(key);
        }
      }
    },
    get(key: string, now = Date.now()): EdgeDomainReadCacheResult {
      const positive = positiveEntries.get(key);
      if (positive) {
        if (now - positive.writtenAt < options.positiveTtlMs) {
          return { hit: true, value: positive.value };
        }
        positiveEntries.delete(key);
      }

      const negativeWrittenAt = negativeEntries.get(key);
      if (negativeWrittenAt !== undefined) {
        if (now - negativeWrittenAt < options.negativeTtlMs) {
          return { hit: true, value: undefined };
        }
        negativeEntries.delete(key);
      }

      return { hit: false };
    },
    setNegative(key: string, now = Date.now()): void {
      positiveEntries.delete(key);
      setBoundedEntry(negativeEntries, key, now, options.maxEntries);
    },
    setPositive(key: string, value: string, now = Date.now()): void {
      negativeEntries.delete(key);
      setBoundedEntry(
        positiveEntries,
        key,
        { value, writtenAt: now },
        options.maxEntries
      );
    },
  };
}

export interface ReadValidatedEdgeMappingOptions {
  cache: ReturnType<typeof createWarmEdgeDomainReadCache>;
  cacheKey: string;
  edgeConfigKey: string;
  isStaleBeforeWrite: () => boolean;
  isStalePositiveWrite?: (normalizedValue: string) => boolean;
  normalizeAndValidate: (raw: string) => string | undefined;
  readKey?: string;
  singleFlight: SingleFlight<string | undefined>;
}

/**
 * Reads, validates, and caches an Edge Config domain/slug mapping while
 * coalescing concurrent reads and preserving generation/epoch fences.
 * Thrown Edge Config errors remain uncached so fallback recovery is immediate.
 */
export function readValidatedEdgeMapping(
  options: ReadValidatedEdgeMappingOptions
): Promise<string | undefined> {
  const cached = options.cache.get(options.cacheKey);
  if (cached.hit) return Promise.resolve(cached.value);

  const flightKey = options.readKey ?? options.cacheKey;
  return options.singleFlight.run(flightKey, async () => {
    const refreshed = options.cache.get(options.cacheKey);
    if (refreshed.hit) return refreshed.value;
    try {
      const { get } = await import('@vercel/edge-config');
      const value = await get<string>(options.edgeConfigKey);
      const staleBeforeWrite = options.isStaleBeforeWrite();
      if (typeof value !== 'string') {
        if (!staleBeforeWrite) {
          options.cache.setNegative(options.cacheKey);
        }
        return undefined;
      }
      const normalized = options.normalizeAndValidate(value);
      if (normalized === undefined) {
        if (!staleBeforeWrite) {
          options.cache.setNegative(options.cacheKey);
        }
        return undefined;
      }
      if (staleBeforeWrite || options.isStalePositiveWrite?.(normalized)) {
        return normalized;
      }
      options.cache.setPositive(options.cacheKey, normalized);
      return normalized;
    } catch {
      // Edge Config not configured or unavailable - fall through to DB without negative caching
      return undefined;
    }
  });
}
