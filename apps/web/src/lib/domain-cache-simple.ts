/**
 * Custom domain lookup for edge middleware
 *
 * Strategy:
 * 1. Read from Vercel Edge Config (global, low-latency mapping)
 * 2. Fall back to in-memory cache + DB query during missing keys or outages
 *
 * Edge Config is synced by the domain webhook through /api/edge-config/sync.
 * Domain mappings are public routing data. The DB fallback is read-only and
 * uses the admin client because middleware runs before an authenticated session.
 */

import {
  getEdgeConfigDomainKey,
  getEdgeConfigSlugKey,
} from '@/lib/edge-config-keys';
import { createWarmPositiveCache } from './create-warm-positive-cache';
import { fetchCustomDomain, fetchSlugForDomain } from './domain-cache-database';
import { SingleFlight } from './single-flight';
import { createAdminClient } from './supabase/admin';

interface CacheEntry {
  customDomain: string | null;
  timestamp: number;
}

// In-memory fallback cache (used when Edge Config is not available)
const domainCache = new Map<string, CacheEntry>();
const DB_CACHE_TTL = 300_000; // Existing 5-minute fallback behavior.
const EDGE_POSITIVE_CACHE_TTL = 60_000;
const MAX_CACHE_SIZE = 1000;
const CANONICAL_HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const CANONICAL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const edgeForwardCache = createWarmPositiveCache({
  maxEntries: MAX_CACHE_SIZE,
  ttlMs: EDGE_POSITIVE_CACHE_TTL,
});
const edgeReverseCache = createWarmPositiveCache({
  maxEntries: MAX_CACHE_SIZE,
  ttlMs: EDGE_POSITIVE_CACHE_TTL,
});
const edgeForwardGenerations = new Map<string, number>();
const edgeReverseGenerations = new Map<string, number>();
let generationSequence = 0;
let reverseInvalidationEpoch = 0;
const reverseSlugInvalidationEpochs = new Map<string, number>();
function bumpGeneration(map: Map<string, number>, key: string): void {
  if (!map.has(key) && map.size >= MAX_CACHE_SIZE) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  generationSequence += 1;
  map.set(key, generationSequence);
}

function getReverseReadKey(domain: string, invalidationEpoch: number): string {
  return `${domain}:${invalidationEpoch}`;
}

// A warm instance may serve a positive Edge Config mapping for at most 60s
// after an external edit; same-process mutation invalidation clears it sooner.

// Fluid instances can handle concurrent requests. Coalesce identical provider
// reads only while they are in flight, then forget them so mapping changes are
// visible on the next request without a cross-instance stale-routing window.
const edgeForwardReads = new SingleFlight<string | undefined>();
const edgeReverseReads = new SingleFlight<string | undefined>();
const forwardDbReads = new SingleFlight<string | null>();
const reverseDbReads = new SingleFlight<string | null>();

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.+$/, '');
}

/** Look up a merchant's primary custom domain by slug. */
export async function getCustomDomainForSlug(
  merchantSlug: string
): Promise<string | null> {
  const normalizedSlug = normalizeSlug(merchantSlug);
  // 1. Try Edge Config (near-zero latency, no DB)
  const edgeDomain = await readFromEdgeConfig(normalizedSlug);
  if (edgeDomain) {
    return edgeDomain;
  }

  // 2. Fall back to in-memory cache + DB.
  // This also covers stale/missing Edge Config keys.
  return getFromCacheOrDb(normalizedSlug);
}

/** Read a domain mapping from Vercel Edge Config. */
function readFromEdgeConfig(merchantSlug: string): Promise<string | undefined> {
  const cached = edgeForwardCache.get(merchantSlug);
  if (cached) return Promise.resolve(cached);

  const generation = edgeForwardGenerations.get(merchantSlug) ?? 0;
  return edgeForwardReads.run(merchantSlug, async () => {
    const refreshed = edgeForwardCache.get(merchantSlug);
    if (refreshed) return refreshed;
    try {
      const { get } = await import('@vercel/edge-config');
      const value = await get<string>(getEdgeConfigSlugKey(merchantSlug));
      if (typeof value !== 'string') return undefined;
      const normalizedValue = normalizeDomain(value);
      if (!CANONICAL_HOSTNAME.test(normalizedValue)) {
        return undefined;
      }
      if ((edgeForwardGenerations.get(merchantSlug) ?? 0) !== generation) {
        return normalizedValue;
      }
      edgeForwardCache.set(merchantSlug, normalizedValue);
      return normalizedValue;
    } catch {
      // Edge Config not configured or unavailable - fall through to DB
      return undefined;
    }
  });
}

/** In-memory cache with DB fallback. */
function getFromCacheOrDb(merchantSlug: string): Promise<string | null> {
  const cached = domainCache.get(merchantSlug);
  if (cached && Date.now() - cached.timestamp < DB_CACHE_TTL) {
    return Promise.resolve(cached.customDomain);
  }

  const generation = edgeForwardGenerations.get(merchantSlug) ?? 0;
  return forwardDbReads.run(merchantSlug, async () => {
    const refreshed = domainCache.get(merchantSlug);
    if (refreshed && Date.now() - refreshed.timestamp < DB_CACHE_TTL) {
      return refreshed.customDomain;
    }

    const customDomain = await fetchCustomDomain(
      createAdminClient(),
      merchantSlug
    );

    if ((edgeForwardGenerations.get(merchantSlug) ?? 0) !== generation) {
      return customDomain;
    }

    if (domainCache.size >= MAX_CACHE_SIZE) {
      const firstKey = domainCache.keys().next().value;
      if (firstKey) domainCache.delete(firstKey);
    }
    domainCache.set(merchantSlug, { customDomain, timestamp: Date.now() });
    return customDomain;
  });
}

/** Drop forward cache entries (including cached negative DB results) on rename. */
export function invalidateForwardDomainCacheForSlug(slug: string): void {
  const normalizedSlug = normalizeSlug(slug);
  edgeForwardReads.forget(normalizedSlug);
  forwardDbReads.forget(normalizedSlug);
  domainCache.delete(normalizedSlug);
  edgeForwardCache.deleteKey(normalizedSlug);
  bumpGeneration(edgeForwardGenerations, normalizedSlug);
}

/**
 * Reverse lookup: given a custom domain, find the merchant slug.
 * Uses in-memory cache with DB fallback (same pattern as getCustomDomainForSlug).
 * Used by the proxy to rewrite SEO file paths (sitemap, robots) without dots in [slug].
 */
interface ReverseCacheEntry {
  slug: string | null;
  timestamp: number;
}

const reverseDomainCache = new Map<string, ReverseCacheEntry>();

/** Drop reverse domain->slug entries that map to a renamed slug. */
export function invalidateReverseDomainCacheForSlug(slug: string): void {
  const normalizedSlug = normalizeSlug(slug);
  reverseInvalidationEpoch += 1;
  if (
    !reverseSlugInvalidationEpochs.has(normalizedSlug) &&
    reverseSlugInvalidationEpochs.size >= MAX_CACHE_SIZE
  ) {
    const oldest = reverseSlugInvalidationEpochs.keys().next().value;
    if (oldest !== undefined) reverseSlugInvalidationEpochs.delete(oldest);
  }
  reverseSlugInvalidationEpochs.set(normalizedSlug, reverseInvalidationEpoch);
  for (const [domain, entry] of reverseDomainCache) {
    if (entry.slug === normalizedSlug) {
      const previousReadKey = getReverseReadKey(
        domain,
        reverseInvalidationEpoch - 1
      );
      edgeReverseReads.forget(previousReadKey);
      reverseDbReads.forget(previousReadKey);
      reverseDomainCache.delete(domain);
      bumpGeneration(edgeReverseGenerations, domain);
    }
  }
  edgeReverseCache.deleteValue(normalizedSlug);
}

export function invalidateReverseDomainCacheForDomain(domain: string): void {
  const normalizedDomain = normalizeDomain(domain);
  const readKey = getReverseReadKey(normalizedDomain, reverseInvalidationEpoch);
  edgeReverseReads.forget(readKey);
  reverseDbReads.forget(readKey);
  reverseDomainCache.delete(normalizedDomain);
  edgeReverseCache.deleteKey(normalizedDomain);
  bumpGeneration(edgeReverseGenerations, normalizedDomain);
}

export async function getSlugForCustomDomain(
  domain: string
): Promise<string | null> {
  const normalizedDomain = normalizeDomain(domain);
  // 1. Try Edge Config reverse mapping (domain_* -> slug)
  const edgeSlug = await readSlugFromEdgeConfig(normalizedDomain);
  if (edgeSlug) {
    return edgeSlug;
  }

  // 2. Fall back to the warm DB result, then the database. Edge Config must
  // remain authoritative when a previously missing mapping becomes available.
  const cached = reverseDomainCache.get(normalizedDomain);
  if (cached && Date.now() - cached.timestamp < DB_CACHE_TTL) {
    return cached.slug;
  }

  const generation = edgeReverseGenerations.get(normalizedDomain) ?? 0;
  const invalidationEpoch = reverseInvalidationEpoch;
  const readKey = getReverseReadKey(normalizedDomain, invalidationEpoch);
  return reverseDbReads.run(readKey, async () => {
    const refreshed = reverseDomainCache.get(normalizedDomain);
    if (refreshed && Date.now() - refreshed.timestamp < DB_CACHE_TTL) {
      return refreshed.slug;
    }

    const slug = await fetchSlugForDomain(
      createAdminClient(),
      normalizedDomain
    );

    if (
      (edgeReverseGenerations.get(normalizedDomain) ?? 0) !== generation ||
      reverseInvalidationEpoch > invalidationEpoch ||
      (slug !== null &&
        (reverseSlugInvalidationEpochs.get(slug) ?? 0) > invalidationEpoch)
    ) {
      return slug;
    }

    if (reverseDomainCache.size >= MAX_CACHE_SIZE) {
      const firstKey = reverseDomainCache.keys().next().value;
      if (firstKey) reverseDomainCache.delete(firstKey);
    }
    reverseDomainCache.set(normalizedDomain, { slug, timestamp: Date.now() });
    return slug;
  });
}

function readSlugFromEdgeConfig(domain: string): Promise<string | undefined> {
  const cached = edgeReverseCache.get(domain);
  if (cached) return Promise.resolve(cached);

  const generation = edgeReverseGenerations.get(domain) ?? 0;
  const invalidationEpoch = reverseInvalidationEpoch;
  const readKey = getReverseReadKey(domain, invalidationEpoch);
  return edgeReverseReads.run(readKey, async () => {
    const refreshed = edgeReverseCache.get(domain);
    if (refreshed) return refreshed;
    try {
      const { get } = await import('@vercel/edge-config');
      const value = await get<string>(getEdgeConfigDomainKey(domain));
      if (typeof value !== 'string' || value.length === 0) return undefined;
      const normalizedSlug = normalizeSlug(value);
      if (!CANONICAL_SLUG.test(normalizedSlug)) {
        return undefined;
      }
      if ((edgeReverseGenerations.get(domain) ?? 0) !== generation) {
        return normalizedSlug;
      }
      if (
        reverseInvalidationEpoch > invalidationEpoch ||
        (reverseSlugInvalidationEpochs.get(normalizedSlug) ?? 0) >
          invalidationEpoch
      ) {
        return normalizedSlug;
      }
      edgeReverseCache.set(domain, normalizedSlug);
      return normalizedSlug;
    } catch {
      return undefined;
    }
  });
}
