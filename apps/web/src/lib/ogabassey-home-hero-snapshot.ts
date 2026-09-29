import 'server-only';
import { isOgabasseyHomeHeroSameOriginEnabled } from '@/config/ogabassey-home-hero-same-origin';
import { OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST } from '@/config/ogabassey-home-hero-snapshot-manifest';
import { OGABASSEY_HOME_HERO_SNAPSHOT_TENANT } from '@/config/ogabassey-home-hero-snapshot-tenant';
import type { OgabasseyHomeHeroSnapshot } from './ogabassey-home-hero-snapshot-types';

// Mirrors MANAGED_FILE_PATTERN in
// scripts/lib/ogabassey-hero-snapshot-config.mjs: bake output names only.
const MANAGED_SNAPSHOT_FILE_PATTERN = /^[0-9a-f]{12}-\d+\.avif$/;

function isValidSnapshotPath(value: string): boolean {
  // Generator-authored paths are plain ASCII with no escapes, so anything
  // percent-encoded is not bake output. Reject before interpreting: a raw
  // `..` substring search would miss `/%2e%2e/` (and double-encoded
  // `/%252e%2e/`), which URL parsers normalize into traversal after this
  // check runs.
  if (value.includes('%') || value.includes('\\')) {
    return false;
  }
  const prefix = `/_hero/${OGABASSEY_HOME_HERO_SNAPSHOT_TENANT}/`;
  if (!value.startsWith(prefix)) {
    return false;
  }
  // The remainder must be exactly one managed filename — no subpaths, so
  // traversal is structurally impossible rather than substring-filtered.
  const fileName = value.slice(prefix.length);
  if (fileName.includes('/') || /[<>"\s]/.test(fileName)) {
    return false;
  }
  return MANAGED_SNAPSHOT_FILE_PATTERN.test(fileName);
}

/**
 * Resolve the same-origin AVIF snapshot for a slide-0 source URL, or null
 * when the CDN path must be used instead.
 *
 * Fail-open by design: flag off, unknown tenant, blank/non-string source,
 * missing manifest entry, entry/source mismatch, or a malformed entry all
 * return null, and every caller treats null as "render the legacy CDN
 * bytes". Rotation safety comes from the exact-URL key: content that
 * rotated after the snapshot was baked has no entry and falls back
 * automatically.
 *
 * Deliberately wall-clock-free: the committed preload slot is prerendered
 * while the `<picture>` resolves per request, so any render-time age gate
 * could disagree across phases (stale shell preloads a snapshot the
 * request-time picture no longer uses, downloading an unused AVIF).
 * Freshness — in-place CDN overwrites (same URL, new bytes) and the
 * re-bake cadence — is enforced instead by the scheduled `--check` (hash
 * plus bake age), which fails loudly: see
 * .github/workflows/ogabassey-hero-snapshot-freshness.yml.
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
