import { createHash } from 'node:crypto';

// Versioned pilot contract identifiers. A policy/recipe change produces a new
// identity; stale manifests and acceptance records never match across it.
export const PILOT_SCHEMA_VERSION = 1;
export const PILOT_POLICY_VERSION = 1;

// Bounded pilot coverage: at most 20 jobs, one job and one encoding at a time
// (serial execution is enforced by the encoder queue).
export const MAX_JOBS = 20;

// Input resource limits (design section 2).
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
// Inventory files are tiny (20 jobs of short records): cap the pre-parse
// read so a corrupt or swapped-in giant file rejects on size instead of
// exhausting the generator before validation runs.
export const MAX_INVENTORY_BYTES = 1 * 1024 * 1024;
export const MAX_DECODED_PIXELS = 40_000_000;
export const MAX_AXIS_PIXELS = 16384;
export const ACCEPTED_INPUT_FORMATS = ['jpeg', 'png', 'webp', 'avif'];

// Decoder hardening applied before every decode.
export const SHARP_LIMITS = {
  failOn: 'warning',
  limitInputChannels: 5,
  limitInputPixels: 40_000_000,
  unlimited: false,
};

// Killable-operation budgets: 15 s per native op, 120 s absolute per job.
export const OP_TIMEOUT_MS = 15_000;
export const JOB_TIMEOUT_MS = 120_000;

// Disk guards: 2 GiB free to start/recheck, 100 MiB staging cap per job.
export const MIN_FREE_BYTES = 2 * 1024 ** 3;
export const MAX_STAGING_BYTES = 100 * 1024 ** 2;

// Stored-manifest ceiling: 24 tiers cap the honest manifest near 10 KiB,
// so 64 KiB bounds a corrupted/replaced manifest.json without valid
// manifests approaching it. loadGeneration reads ceiling+1 and rejects
// truncation before parsing.
export const MAX_MANIFEST_BYTES = 64 * 1024;

// Merchant UUID predicate shared by every contract mirror. Zod 3's
// .uuid() accepts version nibbles (0, f) that Zod 4's z.uuid() rejects,
// so both sides spell the rule explicitly instead: versions 1-8 plus the
// nil/max exceptions. The preflight mirror imports this constant; the
// web schemas duplicate the source (web runtime code must not import
// infra) and the shared corpus pins all three to the same verdicts.
export const PILOT_UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

// Roles and their pixel-width ladders (pixel widths, not CSS viewports).
export const ROLES = ['logo', 'product', 'hero'];
export const TIERS = {
  hero: [384, 768, 1280],
  logo: [96, 192, 384],
  product: [384, 768, 1280],
};

// Explicit-format output tiers with immutable per-format bytes.
export const OUTPUT_FORMATS = [
  { contentType: 'image/avif', format: 'avif' },
  { contentType: 'image/webp', format: 'webp' },
];

// Pilot acceptance ceilings in DECIMAL bytes (design section 3). Quality and
// clarity of embedded text still need visual acceptance.
export const BUDGETS = {
  hero: {
    384: { avif: 20_000, webp: 35_000 },
    768: { avif: 60_000, webp: 90_000 },
    1280: { avif: 150_000, webp: 200_000 },
  },
  logo: {
    96: { avif: 5_000, webp: 5_000 },
    192: { avif: 12_000, webp: 12_000 },
    384: { avif: 25_000, webp: 25_000 },
  },
  product: {
    384: { avif: 25_000, webp: 40_000 },
    768: { avif: 75_000, webp: 100_000 },
    1280: { avif: 150_000, webp: 200_000 },
  },
};

// Quality descent ladder. 55 is the engineering floor: over-budget output at
// the floor fails the complete generation (no further lowering, blur, or
// resolution reduction to manufacture compliance).
export const QUALITY_LADDER = [70, 65, 60, 55];

// Never-larger delivery guard (recipe r2): per-rung body-byte comparison
// against the validated source. Only branch-compatible source codecs may
// pass through into a typed branch; anything else keeps the generated
// rung and records the limitation explicitly.
export const DELIVERY_GUARD = {
  knownSourceFormats: ['avif', 'jpeg', 'png', 'webp'],
  maxBytes: 'source',
  passthroughFormats: ['avif', 'webp'],
};

// Fixed encoder effort for both formats (matches the existing transformer).
export const ENCODER_OPTIONS = {
  avif: { effort: 4 },
  webp: { effort: 4 },
};

// Canonical versioned recipe: tiers, budgets, qualities, formats, options,
// delivery guard. Part of the idempotency identity alongside merchant,
// asset, source hash, role, and encoder identity. r2 adds the never-larger
// delivery guard; r1 generations keep their frozen identity and records.
export const RECIPE_CANONICAL_JSON = JSON.stringify({
  budgets: BUDGETS,
  delivery: DELIVERY_GUARD,
  encoderOptions: ENCODER_OPTIONS,
  formats: ['avif', 'webp'],
  policyVersion: PILOT_POLICY_VERSION,
  qualities: QUALITY_LADDER,
  schemaVersion: PILOT_SCHEMA_VERSION,
  tiers: TIERS,
});

export const RECIPE_ID = `pilot-r2-${createHash('sha256')
  .update(RECIPE_CANONICAL_JSON)
  .digest('hex')
  .slice(0, 16)}`;
