import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCEPTED_INPUT_FORMATS,
  BUDGETS,
  CLAIM_LIVE_WINDOW_MS,
  JOB_TIMEOUT_MS,
  MAX_AXIS_PIXELS,
  MAX_DECODED_PIXELS,
  MAX_INPUT_BYTES,
  MAX_JOBS,
  MAX_STAGING_BYTES,
  MIN_FREE_BYTES,
  OP_TIMEOUT_MS,
  OUTPUT_FORMATS,
  PILOT_POLICY_VERSION,
  PILOT_SCHEMA_VERSION,
  QUALITY_LADDER,
  RECIPE_CANONICAL_JSON,
  RECIPE_ID,
  ROLES,
  SHARP_LIMITS,
  TIERS,
} from './constants.mjs';

test('pins the design contract versions and limits', () => {
  assert.equal(PILOT_SCHEMA_VERSION, 1);
  assert.equal(PILOT_POLICY_VERSION, 1);
  assert.equal(MAX_JOBS, 20);
  assert.equal(MAX_INPUT_BYTES, 10 * 1024 * 1024);
  assert.equal(MAX_DECODED_PIXELS, 40_000_000);
  assert.equal(MAX_AXIS_PIXELS, 16384);
  assert.equal(OP_TIMEOUT_MS, 15_000);
  assert.equal(JOB_TIMEOUT_MS, 120_000);
  assert.equal(CLAIM_LIVE_WINDOW_MS, 150_000);
  assert.equal(MIN_FREE_BYTES, 2 * 1024 ** 3);
  assert.equal(MAX_STAGING_BYTES, 100 * 1024 ** 2);
  assert.deepEqual(QUALITY_LADDER, [70, 65, 60, 55]);
  assert.deepEqual(ROLES, ['logo', 'product', 'hero']);
  assert.deepEqual(ACCEPTED_INPUT_FORMATS, ['jpeg', 'png', 'webp', 'avif']);
});

test('pins the decoder hardening flags', () => {
  assert.deepEqual(SHARP_LIMITS, {
    failOn: 'warning',
    limitInputChannels: 5,
    limitInputPixels: 40_000_000,
    unlimited: false,
  });
});

test('pins the role tier ladders', () => {
  assert.deepEqual(TIERS, {
    hero: [384, 768, 1280],
    logo: [96, 192, 384],
    product: [384, 768, 1280],
  });
  assert.deepEqual(OUTPUT_FORMATS, [
    { contentType: 'image/avif', format: 'avif' },
    { contentType: 'image/webp', format: 'webp' },
  ]);
});

test('pins the decimal-byte role/tier budgets from the design', () => {
  assert.deepEqual(BUDGETS, {
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
  });
});

test('exposes a stable recipe identity derived from the recipe', () => {
  assert.match(RECIPE_ID, /^pilot-r2-[0-9a-f]{16}$/);
  const recipe = JSON.parse(RECIPE_CANONICAL_JSON);
  assert.equal(recipe.policyVersion, PILOT_POLICY_VERSION);
  assert.deepEqual(recipe.qualities, QUALITY_LADDER);
  assert.deepEqual(recipe.tiers, TIERS);
  assert.deepEqual(recipe.budgets, BUDGETS);
});
