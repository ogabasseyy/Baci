// Lab-only merchant image variant pilot constants. Shared by the manifest,
// acceptance, and inventory-binding schemas; the values mirror the
// standalone generator contract in infra/cdn-transformer/pilot. No zod
// imports here: pure constants only.
export const PILOT_SCHEMA_VERSION = 1;
export const PILOT_POLICY_VERSION = 1;
export const PILOT_RECIPE_ID = 'pilot-r2-a1323f0dc00f1ecb';
export const PILOT_MAX_JOBS = 20;
// Mirror of MAX_DECODED_PIXELS in
// infra/cdn-transformer/pilot/constants.mjs. Pinned by the shared
// contract fixtures (sourcePixelsTooMany must fail on both sides) and
// lab-decode-limits.test.mjs.
export const PILOT_MAX_DECODED_PIXELS = 40_000_000;
// Mirror of MAX_INPUT_BYTES in
// infra/cdn-transformer/pilot/constants.mjs: the manifest source-bytes
// claim is capped at the acquisition ceiling on every mirror, so an
// unbounded claim cannot become a bounded-read allocation ceiling.
// Pinned by the shared contract fixtures.
export const PILOT_MAX_INPUT_BYTES = 10 * 1024 * 1024;
// Mirror of the channel ceiling in assertAcceptedMetadata
// (encode-worker.mjs) and SHARP_LIMITS (constants.mjs): lab verification
// decodes under the same limits as the generator.
// Pinned by lab-decode-limits.test.mjs.
export const PILOT_MAX_DECODE_CHANNELS = 5;
export const PILOT_SHARP_LIMITS = {
  failOn: 'warning',
  limitInputChannels: 5,
  limitInputPixels: 40_000_000,
  unlimited: false,
} as const;

export const PILOT_TIERS = {
  hero: [384, 768, 1280],
  logo: [96, 192, 384],
  product: [384, 768, 1280],
} as const;

export type PilotRole = keyof typeof PILOT_TIERS;

export const PILOT_SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const PILOT_TIER_PATH_PATTERN = /^[0-9a-f]{64}\.(avif|webp)$/;
// Duplicate of PILOT_UUID_PATTERN in
// infra/cdn-transformer/pilot/constants.mjs (web runtime code must not
// import infra): merchant UUIDs accept versions 1-8 plus the nil/max
// exceptions on every mirror. Pinned by the shared corpus.
export const PILOT_UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;
