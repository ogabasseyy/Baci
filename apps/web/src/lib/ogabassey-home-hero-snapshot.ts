import 'server-only';
import { isOgabasseyHomeHeroSameOriginEnabled } from '@/config/ogabassey-home-hero-same-origin';
import { OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST } from '@/config/ogabassey-home-hero-snapshot-manifest';
import { OGABASSEY_HOME_HERO_SNAPSHOT_TENANT } from '@/config/ogabassey-home-hero-snapshot-tenant';
import type { OgabasseyHomeHeroSnapshot } from './ogabassey-home-hero-snapshot-types';

// Fail-closed freshness gate: CDN source paths are mutable (the CDN
// transformer keys its cache on source size + mtime), so an exact URL
// match alone cannot prove the checked-in bytes still represent the
// source. Entries older than this stop resolving (CDN fallback) until a
// re-bake refreshes them; `--check` detects in-place overwrites sooner.
const SNAPSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function isValidSnapshotPath(value: string): boolean {
  return (
    value.startsWith('/_hero/') &&
    !value.includes('..') &&
    !value.includes('\\') &&
    !/[<>"\s]/.test(value)
  );
}

/**
 * Resolve the same-origin AVIF snapshot for a slide-0 source URL, or null
 * when the CDN path must be used instead.
 *
 * Fail-open by design: flag off, unknown tenant, blank/non-string source,
 * missing manifest entry, entry/source mismatch, a malformed entry, or an
 * entry older than SNAPSHOT_MAX_AGE_MS all return null, and every caller
 * treats null as "render the legacy CDN bytes". Rotation safety comes from
 * the exact-URL key: content that rotated after the snapshot was baked has
 * no entry and falls back automatically. The age gate additionally bounds
 * in-place overwrites (same URL, new bytes): without it a stale snapshot
 * would serve indefinitely, since nothing revalidates content at request
 * time.
 *
 * Static data only (no backend reads, no request APIs), so the first-flush
 * committed slot may call this without breaking its streaming constraint.
 */
export function resolveOgabasseyHomeHeroSnapshot(
  tenantSlug: string | null | undefined,
  sourceUrl: string | null | undefined
): OgabasseyHomeHeroSnapshot | null {
  try {
    if (!isOgabasseyHomeHeroSameOriginEnabled()) {
      return null;
    }
    if (typeof tenantSlug !== 'string' || typeof sourceUrl !== 'string') {
      return null;
    }
    const slug = tenantSlug.trim().toLowerCase();
    const source = sourceUrl.trim();
    if (
      !slug ||
      !source ||
      slug !== OGABASSEY_HOME_HERO_SNAPSHOT_TENANT.toLowerCase()
    ) {
      return null;
    }
    const tenantEntries = OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST[slug];
    const entry = tenantEntries?.[source];
    if (!entry || entry.sourceUrl !== source) {
      return null;
    }
    // Freshness gate: a missing/unparseable timestamp or an entry older
    // than the max age fails closed to the CDN path (re-bake to refresh).
    const bakedAt = Date.parse(entry.bakedAt ?? '');
    if (
      !Number.isFinite(bakedAt) ||
      Date.now() - bakedAt > SNAPSHOT_MAX_AGE_MS
    ) {
      return null;
    }
    if (
      typeof entry.srcSet !== 'string' ||
      typeof entry.href !== 'string' ||
      !entry.srcSet.trim() ||
      !entry.href.trim()
    ) {
      return null;
    }
    // Every srcSet candidate and the preload href must be an app-local
    // snapshot path. A manifest that points off-origin (or at an unexpected
    // route) is rejected rather than rendered.
    const candidates = entry.srcSet
      .split(',')
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean);
    if (
      candidates.length === 0 ||
      !candidates.every(isValidSnapshotPath) ||
      !isValidSnapshotPath(entry.href.trim())
    ) {
      return null;
    }
    return {
      sourceUrl: source,
      srcSet: entry.srcSet.trim(),
      href: entry.href.trim(),
    };
  } catch {
    return null;
  }
}
