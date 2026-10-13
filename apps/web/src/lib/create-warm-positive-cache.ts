interface WarmPositiveCacheOptions {
  maxEntries: number;
  ttlMs: number;
}

export function createWarmPositiveCache(options: WarmPositiveCacheOptions) {
  const entries = new Map<string, { value: string; writtenAt: number }>();

  return {
    deleteKey(key: string) {
      entries.delete(key);
    },
    deleteValue(value: string) {
      for (const [key, entry] of entries) {
        if (entry.value === value) entries.delete(key);
      }
    },
    get(key: string, now = Date.now()): string | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (now - entry.writtenAt < options.ttlMs) return entry.value;
      entries.delete(key);
      return undefined;
    },
    set(key: string, value: string, now = Date.now()) {
      if (entries.size >= options.maxEntries && !entries.has(key)) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey !== undefined) entries.delete(oldestKey);
      }
      entries.set(key, { value, writtenAt: now });
    },
  };
}
