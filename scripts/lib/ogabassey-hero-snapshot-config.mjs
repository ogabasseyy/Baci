// Shared constants for the OgaBassey mobile home-hero snapshot pipeline
// (see scripts/lib/ogabassey-hero-snapshots.mjs).

// The mobile hero's responsive ladder, mirroring what next/image emits for
// the AVIF tier (get-img-props getWidths: allSizes at or above
// deviceSizes[0] x smallest-vw-ratio = 640 x 0.40 = 256 — so 256/384 from
// Next's default imageSizes ARE real emitted buckets; see also
// HOME_HERO_IMAGE_WIDTH_QUALITY_PAIRS in ogabassey-image-prewarm-pairs.ts).
// Tiers at/above 1440 are excluded: the <source> is capped at
// (max-width: 767px), so the largest reachable pick is ~920px (767 x 40vw x
// DPR 3); 1200 is headroom covering DPR <= 3.9. Keep in sync with the
// PIPELINE_WIDTHS mirrors in the apps/web snapshot tests.
export const SNAPSHOT_WIDTHS = [256, 384, 640, 750, 828, 1080, 1200];
// MUST equal MOBILE_HERO_IMAGE_QUALITY in
// apps/web/src/components/storefront/ogabassey/components/hero-mobile-image-config.ts.
// The value is written into each manifest entry and asserted by unit test.
export const SNAPSHOT_QUALITY = 70;
export const DEFAULT_WIDTH = 960;
export const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
// Per-URL download deadline: generous for a <=15MB CDN fetch (effective
// floor ~1Mbps), but a stalled server must fail, never hang the pipeline.
export const DOWNLOAD_TIMEOUT_MS = 120_000;
export const MANAGED_FILE_PATTERN = /^[0-9a-f]{12}-\d+\.avif$/;
// Re-bake cadence enforced by `--check` (see
// .github/workflows/ogabassey-hero-snapshot-freshness.yml). This is the
// single source of truth for the freshness window: the runtime resolver is
// intentionally wall-clock-free so prerendered and request-time consumers
// always agree, and freshness is enforced here instead.
export const SNAPSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
