import { createAnonClient } from '@/lib/supabase/anon';

interface LivenessEntry {
  isLive: boolean;
  timestamp: number;
}

// slug -> whether a live merchant currently owns it.
const livenessCache = new Map<string, LivenessEntry>();

// Liveness can flip the instant a merchant renames BACK to a retired slug. This
// is BOTH the redirect-loop residual bound (a rename-back can be served stale
// for at most this long) AND the liveness DB-read-rate knob under bot floods.
// Keep it small; raising it toward POSITIVE_TTL re-grows the loop window.
const LIVENESS_TTL = 10_000; // 10 seconds
const MAX_CACHE_SIZE = 1000;
let invalidationEpoch = 0;

/** Drop this instance's cached liveness for a slug (rename flow). */
export function invalidateSlugLiveness(slug: string): void {
  // A read already in flight predates the rename and must not write back.
  invalidationEpoch += 1;
  livenessCache.delete(slug);
}

/**
 * Whether a live merchant currently owns the slug. Cached only briefly: see
 * LIVENESS_TTL. Strict callers throw on a failed lookup instead of assuming live.
 */
export async function isSlugLive(
  slug: string,
  strict = false
): Promise<boolean> {
  // Strict callers bypass the cache read (same failure-negative
  // reasoning as resolveAliasMapping: a cached live=true may be a
  // fail-safe from a failed lenient liveness check).
  if (!strict) {
    const cached = livenessCache.get(slug);
    if (cached && Date.now() - cached.timestamp < LIVENESS_TTL) {
      return cached.isLive;
    }
  }

  const epoch = invalidationEpoch;
  const isLive = await fetchSlugIsLive(slug, strict);
  if (epoch === invalidationEpoch) {
    evictIfFull(livenessCache);
    livenessCache.set(slug, { isLive, timestamp: Date.now() });
  }
  return isLive;
}

async function fetchSlugIsLive(slug: string, strict = false): Promise<boolean> {
  let result: { data: unknown; error: unknown };
  try {
    const supabase = createAnonClient();

    result = await supabase
      .from('merchants')
      .select('id')
      .eq('slug', slug)
      .limit(1)
      .maybeSingle();
  } catch (err) {
    console.error('[Slug Alias Cache] Error in liveness check', {
      slug,
      error: err,
    });
    if (strict) {
      throw err;
    }
    return true;
  }

  if (result.error) {
    // Fail safe: if we can't confirm the slug is free, treat it as LIVE so we
    // do NOT 301 away from a store that may still be live under this slug. A
    // straggler 404 on the retired URL is far less harmful than redirecting a
    // live store's traffic away. Strict callers throw instead: with a known
    // alias mapping, unknown liveness is indeterminate (retryable), not live.
    // The throw stays outside the try so the catch above doesn't double-log.
    console.error('[Slug Alias Cache] Failed liveness check', {
      slug,
      error: result.error,
    });
    if (strict) {
      throw new Error(
        `[Slug Alias Cache] liveness lookup failed for slug: ${slug}`
      );
    }
    return true;
  }

  return Boolean(result.data);
}

// Simple FIFO eviction, matching domain-cache-simple.ts.
function evictIfFull<V>(cache: Map<string, V>): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey) {
      cache.delete(firstKey);
    }
  }
}
