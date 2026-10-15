// Deterministic shared-contract fixture generator. Run from
// infra/cdn-transformer: node pilot/fixtures/make-contract-fixtures.mjs
// Output (contract-fixtures.json) is consumed by BOTH the standalone
// generator tests and the web Zod-mirror tests, so either side breaks loudly
// if the contract drifts.
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PILOT_POLICY_VERSION,
  PILOT_SCHEMA_VERSION,
  RECIPE_ID,
} from '../constants.mjs';
import {
  GUARD_SOURCE,
  guardedTiers,
  logoTiers,
  validAcceptance,
  validManifest,
  validManifestGuarded,
} from './contract-fixture-builders.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const manifest = validManifest();
const acceptance = validAcceptance();
const guarded = validManifestGuarded();
const mutateGuardedTier = (index, patch) => ({
  ...guarded,
  tiers: guardedTiers().map((tier, position) =>
    position === index ? { ...tier, ...patch } : tier
  ),
});
// Delivery omission (key removed, not nulled): the current-recipe
// omission the never-larger checks must reject.
const stripGuardedTierDelivery = (index) => ({
  ...guarded,
  tiers: guardedTiers().map((tier, position) => {
    if (position !== index) {
      return tier;
    }
    const { delivery, ...rest } = tier;
    void delivery;
    return rest;
  }),
});
const shortTiers = logoTiers().slice(0, 5);
const manyTiers = Array.from({ length: 25 }, (_, index) => ({
  ...logoTiers()[index % 6],
}));

const fixtures = {
  pinned: {
    policyVersion: PILOT_POLICY_VERSION,
    recipeId: RECIPE_ID,
    schemaVersion: PILOT_SCHEMA_VERSION,
  },
  invalidAcceptanceSchemas: {
    badHash: { ...acceptance, outputHashes: ['not-a-hash'] },
    badQualities: { ...acceptance, qualities: ['high'] },
    badMerchantV0: {
      ...acceptance,
      merchantId: '12345678-1234-0234-8234-123456789abc',
    },
    badMerchantVf: {
      ...acceptance,
      merchantId: '12345678-1234-f234-8234-123456789abc',
    },
    badOriginalUrl: { ...acceptance, originalUrl: 'not-a-url' },
    badVerdict: { ...acceptance, verdict: 'maybe' },
    emptyHashes: { ...acceptance, outputHashes: [] },
    longNote: { ...acceptance, note: 'x'.repeat(501) },
    unknownField: { ...acceptance, extra: true },
  },
  invalidManifests: {
    assetIdTooLong: { ...manifest, assetId: 'a'.repeat(129) },
    badContentType: {
      ...manifest,
      tiers: logoTiers().map((tier, index) =>
        index === 0 ? { ...tier, contentType: 'image/jpeg' } : tier
      ),
    },
    badCreatedAt: { ...manifest, createdAt: 'not-a-date' },
    badEncoderExtra: {
      ...manifest,
      encoder: { ...manifest.encoder, extra: true },
    },
    badEncoderName: {
      ...manifest,
      encoder: { ...manifest.encoder, name: 'imagemagick' },
    },
    badEncoderShape: {
      ...manifest,
      encoder: { name: 'sharp', sharpVersion: '0.35.4' },
    },
    badMerchant: { ...manifest, merchantId: 'not-a-uuid' },
    badSourceBytes: {
      ...manifest,
      source: { ...manifest.source, bytes: 500 * 1024 * 1024 },
    },
    badPolicyVersion: { ...manifest, policyVersion: 2 },
    badQuality: {
      ...manifest,
      tiers: logoTiers().map((tier, index) =>
        index === 0 ? { ...tier, quality: 35 } : tier
      ),
    },
    badRole: { ...manifest, role: 'banner' },
    badSchemaVersion: { ...manifest, schemaVersion: 2 },
    contentTypeFormatMismatch: {
      ...manifest,
      tiers: logoTiers().map((tier, index) =>
        index === 0 ? { ...tier, contentType: 'image/webp' } : tier
      ),
    },
    deliveryNull: mutateGuardedTier(0, { delivery: null }),
    emptyTiers: { ...manifest, tiers: [] },
    generatedAboveSource: mutateGuardedTier(0, { bytes: 5001 }),
    generatedHeightOffAspect: mutateGuardedTier(0, { height: 80 }),
    generatedWidthTooNarrow: mutateGuardedTier(0, {
      actualWidth: 48,
      width: 48,
    }),
    generatedWidthUpscaled: mutateGuardedTier(0, {
      actualWidth: 900,
      width: 900,
    }),
    generatedWithoutQuality: mutateGuardedTier(0, { quality: null }),
    r2MissingDelivery: stripGuardedTierDelivery(0),
    overSourceWithoutCause: mutateGuardedTier(3, { bytes: 4000 }),
    // 100 KB on the logo/384/webp rung (ceiling 25 KB): the disposition
    // still holds, so only the byte ceiling rejects it — in all mirrors.
    overRecipeCeiling: mutateGuardedTier(5, { bytes: 100_000 }),
    passthroughByteMismatch: mutateGuardedTier(2, { bytes: 4999 }),
    passthroughWithQuality: mutateGuardedTier(2, { quality: 70 }),
    passthroughWrongCodec: mutateGuardedTier(2, {
      contentType: 'image/webp',
      format: 'webp',
      path: `${GUARD_SOURCE}.webp`,
    }),
    qualityZero: {
      ...manifest,
      tiers: logoTiers().map((tier, index) =>
        index === 0 ? { ...tier, quality: 0 } : tier
      ),
    },
    // Same ladder, wrong order: acceptance hashes bind positionally, so a
    // reordered ladder must fail the contract on every suite.
    reorderedTiers: { ...manifest, tiers: [...logoTiers()].reverse() },
    sourceExtraField: {
      ...manifest,
      source: { ...manifest.source, extra: true },
    },
    // Sharp-decodable but generator-rejected input class: no suite may
    // accept a manifest whose source the generator would refuse to encode.
    sourceFormatGif: {
      ...manifest,
      source: { ...manifest.source, format: 'gif' },
    },
    // 100 MP passes both axis ceilings but exceeds the 40 MP decoded
    // limit the generator enforces: no suite may certify it.
    sourcePixelsTooMany: {
      ...manifest,
      source: {
        ...manifest.source,
        orientedHeight: 10000,
        orientedWidth: 10000,
      },
    },
    tierBytesZero: {
      ...manifest,
      tiers: logoTiers().map((tier, index) =>
        index === 0 ? { ...tier, bytes: 0 } : tier
      ),
    },
    tierExtraField: {
      ...manifest,
      tiers: logoTiers().map((tier, index) =>
        index === 0 ? { ...tier, extra: true } : tier
      ),
    },
    widthActualMismatch: {
      ...manifest,
      tiers: logoTiers().map((tier, index) =>
        index === 0 ? { ...tier, actualWidth: 48 } : tier
      ),
    },
    duplicateTier: { ...manifest, tiers: [...logoTiers(), logoTiers()[0]] },
    hashPathMismatch: {
      ...manifest,
      tiers: logoTiers().map((tier, index) =>
        index === 0 ? { ...tier, sha256: 'f'.repeat(64) } : tier
      ),
    },
    missingTier: { ...manifest, tiers: shortTiers },
    remoteUrlPath: {
      ...manifest,
      tiers: logoTiers().map((tier, index) =>
        index === 0 ? { ...tier, path: 'https://example.com/x.avif' } : tier
      ),
    },
    tooManyTiers: { ...manifest, tiers: manyTiers },
    traversalPath: {
      ...manifest,
      tiers: logoTiers().map((tier, index) =>
        index === 0 ? { ...tier, path: '../escape.avif' } : tier
      ),
    },
    unknownField: { ...manifest, extra: true },
    wrongLadder: {
      ...manifest,
      tiers: logoTiers().map((tier) => ({ ...tier, requestedWidth: 768 })),
    },
  },
  matcherRejections: {
    changedOutput: {
      ...acceptance,
      outputHashes: [...acceptance.outputHashes.slice(1), 'e'.repeat(64)],
    },
    // Same hash set, wrong positions: positional binding rejects the swap.
    swappedOutput: {
      ...acceptance,
      outputHashes: [...acceptance.outputHashes].reverse(),
    },
    changedRecipe: { ...acceptance, recipeId: 'pilot-r1-other' },
    changedSource: { ...acceptance, sourceSha256: 'd'.repeat(64) },
    changedUrl: {
      ...acceptance,
      originalUrl: 'https://cdn.example.com/media/logo-retargeted.png',
    },
    rejectedVerdict: { ...acceptance, verdict: 'rejected' },
  },
  validAcceptance: acceptance,
  validAcceptanceOffset: {
    ...acceptance,
    reviewedAt: '2026-10-01T22:00:00+01:00',
  },
  validManifest: manifest,
  validManifestGuarded: guarded,
  validManifestOffset: { ...manifest, createdAt: '2026-10-01T21:00:00+01:00' },
};

await writeFile(
  join(here, 'contract-fixtures.json'),
  `${JSON.stringify(fixtures, null, 2)}\n`
);
console.log('wrote contract-fixtures.json');
