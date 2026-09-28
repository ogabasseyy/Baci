import { OGABASSEY_TEMPLATE_ID } from './templates';

/**
 * Dark-launch flag for same-origin delivery of the OgaBassey mobile home-hero
 * slide-0 image (AVIF tier only).
 *
 * When OFF (the default, and the state this merges in), every hero render
 * path is byte-for-byte the legacy CDN path: the preload link, the flight
 * `preload()` hint, and the rendered `<picture>` all use the CDN transform
 * URLs built by the existing projection/loader. Flipping
 * `NEXT_PUBLIC_OGABASSEY_HOME_HERO_SAME_ORIGIN_ENABLED=true` lets the
 * slide-0 AVIF tier resolve to a same-origin snapshot from
 * `ogabassey-home-hero-snapshot-manifest.ts` instead.
 *
 * The flag alone never changes bytes: each render site additionally requires
 * a manifest entry whose `sourceUrl` exactly equals the slide-0 URL being
 * rendered. A rotated slide, an unknown tenant key, or a missing entry falls
 * back to the CDN path silently (fail-open, like the existing hints).
 *
 * Read as a full literal `process.env.NEXT_PUBLIC_*` expression so Next.js can
 * inline it at build time (same pattern as
 * `NEXT_PUBLIC_WALLET_ORDER_AUTO_DEBIT_ENABLED`).
 */
export function isOgabasseyHomeHeroSameOriginEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_OGABASSEY_HOME_HERO_SAME_ORIGIN_ENABLED === 'true'
  );
}

/** Tenant key the snapshot pipeline writes under. Only this tenant has
 *  snapshots; every other slug resolves to null (CDN fallback). Multi-tenant
 *  snapshots would add manifest keys and pass `merchant.slug` at call sites —
 *  current scope is ogabassey-only and every call site is in an
 *  ogabassey-specific file. Lives here (not in the resolver) so the
 *  resolver module keeps a single primary export. */
export const OGABASSEY_HOME_HERO_SNAPSHOT_TENANT = OGABASSEY_TEMPLATE_ID;
