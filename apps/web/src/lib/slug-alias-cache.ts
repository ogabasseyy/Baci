/**
 * Retired-slug (storefront URL) resolution for the edge proxy.
 *
 * When a merchant renames their storefront URL, the old slug is recorded in
 * `merchant_slug_aliases` (see 20260707074000_merchant_slug_rename_flow.sql) so
 * the old subdomain can 301 to the current one and existing links survive.
 *
 * This mirrors domain-cache-simple.ts: an in-memory TTL cache backed by a
 * read-only ANON DB lookup. It is public routing data (the table grants anon
 * SELECT on old_slug + merchant_id; merchants is anon-readable), so a static
 * anon client is sufficient — and REQUIRED, because this helper is also called
 * from user-facing API routes (storefront/social auth), where the service-role
 * client is forbidden ("never use service-role for user-facing operations").
 *
 * Two separate caches, on purpose:
 *   1. The alias MAPPING (old_slug -> merchant's current slug, or null when the
 *      slug is not a retired alias). This is stable — it only changes when the
 *      merchant renames again — so positives are cached a while. Negatives
 *      ("not an alias") expire fast: a live storefront caches a negative for its
 *      own slug on every request, and that exact slug becomes a retired alias
 *      the instant the merchant renames, so a long negative TTL would make the
 *      just-retired subdomain 404 instead of 301 for the whole window.
 *   2. Slug LIVENESS (is this slug currently a real merchant's slug?). A live
 *      merchant must always win over a retired alias, so every resolve re-checks
 *      liveness — even on a mapping cache HIT. Without that, a merchant renaming
 *      BACK to a retired slug (which makes the old slug live again) would keep
 *      301ing the now-live slug away for up to POSITIVE_TTL — a redirect loop
 *      (old -> new -> old). Liveness is cached only briefly (LIVENESS_TTL) so
 *      that loop window is bounded to seconds while bot floods on retired URLs
 *      are still absorbed. Edge Config is skipped (nothing syncs aliases there).
 */

import { createAnonClient } from '@/lib/supabase/anon';

interface AliasMappingEntry {
  currentSlug: string | null;
  timestamp: number;
}

interface LivenessEntry {
  isLive: boolean;
  timestamp: number;
}

// old_slug -> merchant's current slug (or null when not a retired alias).
const aliasMappingCache = new Map<string, AliasMappingEntry>();
// slug -> whether a live merchant currently owns it.
const livenessCache = new Map<string, LivenessEntry>();

// Confirmed alias -> current slug is stable; cache it a while.
const POSITIVE_TTL = 120_000; // 2 minutes
// "Not an alias" must expire quickly so a fresh rename starts redirecting fast.
const NEGATIVE_TTL = 30_000; // 30 seconds
// Liveness can flip the instant a merchant renames BACK to a retired slug. This
// is BOTH the redirect-loop residual bound (a rename-back can be served stale
// for at most this long) AND the liveness DB-read-rate knob under bot floods.
// Keep it small; raising it toward POSITIVE_TTL re-grows the loop window.
const LIVENESS_TTL = 10_000; // 10 seconds
const MAX_CACHE_SIZE = 1000;

/**
 * Drop this instance's cached alias/liveness entries for a slug. A live
 * storefront caches a NEGATIVE ("not an alias") mapping entry for its own slug on
 * every request; when that slug is retired by a rename, the negative entry would
 * otherwise keep the just-retired host from 301ing for up to NEGATIVE_TTL. The
 * rename flow calls this for both the old and new slug so the redirect starts
 * immediately on the serving instance (other instances are bounded by the short
 * negative TTL).
 */
export function invalidateAliasCacheForSlug(slug: string): void {
  aliasMappingCache.delete(slug);
  livenessCache.delete(slug);
  // Also drop mapping entries whose cached CURRENT-slug value IS this slug. On a
  // repeat rename (X->Y then Y->Z), an older alias cached as `oldAlias -> Y` now
  // points at a retired slug; left stale it would fail the custom-domain
  // `aliasCurrentSlug === domainMerchantSlug` check and stop redirecting.
  for (const [key, entry] of aliasMappingCache) {
    if (entry.currentSlug === slug) {
      aliasMappingCache.delete(key);
    }
  }
}

/**
 * Given a slug pulled off an incoming `*.usebaci.com` subdomain (or a
 * root-domain path prefix), return the merchant's CURRENT slug when that slug is
 * a retired alias (the store was renamed), otherwise null. Callers 301 to the
 * current slug when the returned value differs from the requested one.
 *
 * A live merchant ALWAYS wins over a retired alias: even on a mapping cache hit,
 * this re-checks whether `oldSlug` is itself a live merchant now (rename-back /
 * reclaim) and returns null if so, so it never 301s away from a real store.
 */
export async function getCurrentSlugForAlias(
  oldSlug: string
): Promise<string | null> {
  const currentSlug = await resolveAliasMapping(oldSlug);
  if (!currentSlug) {
    return null;
  }

  // Re-run on EVERY resolve (hit or miss). See the LIVENESS_TTL note above.
  if (await isSlugLive(oldSlug)) {
    return null;
  }

  return currentSlug;
}

/**
 * Strict variant for API routes that must distinguish "no alias"
 * (null) from "alias lookup failed" (throws). The proxy-facing
 * default stays null-on-error — a failed lookup must not 500 the
 * storefront — but routes map the throw to a retryable 5xx so a
 * transient alias-DB blip doesn't present as a permanent 404 (which
 * polling clients treat as terminal and never retry).
 */
export async function getCurrentSlugForAliasStrict(
  oldSlug: string
): Promise<string | null> {
  const currentSlug = await resolveAliasMapping(oldSlug, true);
  if (!currentSlug) {
    return null;
  }

  if (await isSlugLive(oldSlug, true)) {
    return null;
  }

  return currentSlug;
}

async function resolveAliasMapping(
  oldSlug: string,
  strict = false
): Promise<string | null> {
  const cached = aliasMappingCache.get(oldSlug);
  if (cached) {
    const ttl = cached.currentSlug === null ? NEGATIVE_TTL : POSITIVE_TTL;
    if (Date.now() - cached.timestamp < ttl) {
      return cached.currentSlug;
    }
  }

  // Strict failures throw before reaching the cache write, so a
  // transient blip is never cached as a negative.
  const currentSlug = await fetchAliasMapping(oldSlug, strict);
  evictIfFull(aliasMappingCache);
  aliasMappingCache.set(oldSlug, { currentSlug, timestamp: Date.now() });
  return currentSlug;
}

async function fetchAliasMapping(
  oldSlug: string,
  strict = false
): Promise<string | null> {
  let result: { data: unknown; error: unknown };
  try {
    const supabase = createAnonClient();

    result = await supabase
      .from('merchant_slug_aliases')
      .select('merchants!inner(slug)')
      .eq('old_slug', oldSlug)
      .limit(1)
      .maybeSingle();
  } catch (err) {
    console.error('[Slug Alias Cache] Error resolving alias', {
      oldSlug,
      error: err,
    });
    if (strict) {
      throw err;
    }
    return null;
  }

  // Strict throws stay outside the try so the catch above doesn't log
  // them a second time.
  if (result.error) {
    return handleAliasMappingError(oldSlug, result.error, strict);
  }

  const alias = result.data as { merchants: unknown } | null;
  if (!alias) {
    return null;
  }

  const currentSlug =
    (alias.merchants as unknown as { slug: string }).slug ?? null;

  // Self-reference guard (NOT liveness): an alias row whose merchant still
  // carries the same slug is a no-op and must never produce a redirect.
  if (!currentSlug || currentSlug === oldSlug) {
    return null;
  }

  return currentSlug;
}

function handleAliasMappingError(
  oldSlug: string,
  error: unknown,
  strict: boolean
): null {
  console.error('[Slug Alias Cache] Failed to resolve alias', {
    oldSlug,
    error,
  });
  if (strict) {
    throw new Error(
      `[Slug Alias Cache] alias lookup failed for slug: ${oldSlug}`
    );
  }
  return null;
}

async function isSlugLive(slug: string, strict = false): Promise<boolean> {
  const cached = livenessCache.get(slug);
  if (cached && Date.now() - cached.timestamp < LIVENESS_TTL) {
    return cached.isLive;
  }

  const isLive = await fetchSlugIsLive(slug, strict);
  evictIfFull(livenessCache);
  livenessCache.set(slug, { isLive, timestamp: Date.now() });
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
