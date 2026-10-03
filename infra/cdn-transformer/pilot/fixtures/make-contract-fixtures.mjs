// Deterministic shared-contract fixture generator. Run from
// infra/cdn-transformer: node pilot/fixtures/make-contract-fixtures.mjs
// Output (contract-fixtures.json) is consumed by BOTH the standalone
// generator tests and the web Zod-mirror tests, so either side breaks loudly
// if the contract drifts.
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PILOT_POLICY_VERSION,
  PILOT_SCHEMA_VERSION,
  RECIPE_ID,
} from '../constants.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RECIPE = RECIPE_ID;
// Frozen r1 recipe identity: delivery-less tiers are valid ONLY under a
// non-current recipe. The plain validManifest pair below is the frozen
// r1 legacy case; current-recipe manifests must record delivery.
const RECIPE_FROZEN_R1 = 'pilot-r1-0123456789abcdef';
const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const SOURCE = createHash('sha256').update('contract-source').digest('hex');

function tierHash(width, format) {
  return createHash('sha256').update(`tier:${width}:${format}`).digest('hex');
}

const GUARD_SOURCE = createHash('sha256').update('contract-guard-source').digest('hex');
const GUARD_SOURCE_BYTES = 5000;

// Guarded r2 ladder: an avif source with mixed dispositions across one
// ladder — small rungs generated, large compatible rungs passing through,
// large webp rungs flagged over-source (avif source, webp branch).
function guardedTiers() {
  const avifPassthrough = (requestedWidth) => ({
    actualWidth: 800,
    bytes: GUARD_SOURCE_BYTES,
    contentType: 'image/avif',
    delivery: 'original-passthrough',
    format: 'avif',
    height: 600,
    path: `${GUARD_SOURCE}.avif`,
    quality: null,
    requestedWidth,
    sha256: GUARD_SOURCE,
    width: 800,
  });
  const generated = (requestedWidth, format, bytes, quality) => {
    const sha256 = createHash('sha256')
      .update(`guard-tier:${requestedWidth}:${format}`)
      .digest('hex');
    return {
      actualWidth: requestedWidth,
      bytes,
      contentType: `image/${format}`,
      delivery: 'generated',
      format,
      height: Math.round((requestedWidth * 3) / 4),
      path: `${sha256}.${format}`,
      quality,
      requestedWidth,
      sha256,
      width: requestedWidth,
    };
  };
  const overSource = (requestedWidth, format, bytes, quality) => ({
    ...generated(requestedWidth, format, bytes, quality),
    delivery: 'generated-over-source',
  });
  return [
    generated(96, 'avif', 1096, 70),
    generated(96, 'webp', 1210, 70),
    avifPassthrough(192),
    overSource(192, 'webp', 6000, 70),
    avifPassthrough(384),
    overSource(384, 'webp', 9000, 65),
  ];
}

function validManifestGuarded() {
  return {
    ...validManifest(),
    recipeId: RECIPE,
    source: {
      bytes: GUARD_SOURCE_BYTES,
      format: 'avif',
      orientedHeight: 600,
      orientedWidth: 800,
      sha256: GUARD_SOURCE,
    },
    tiers: guardedTiers(),
  };
}

function logoTiers() {
  const tiers = [];
  for (const requestedWidth of [96, 192, 384]) {
    for (const format of ['avif', 'webp']) {
      const sha256 = tierHash(requestedWidth, format);
      tiers.push({
        actualWidth: requestedWidth,
        bytes: 1000 + requestedWidth,
        contentType: `image/${format}`,
        format,
        height: Math.round((requestedWidth * 3) / 4),
        path: `${sha256}.${format}`,
        quality: 70,
        requestedWidth,
        sha256,
        width: requestedWidth,
      });
    }
  }
  return tiers;
}

function validManifest() {
  return {
    assetId: 'logo-contract',
    createdAt: '2026-10-01T20:00:00.000Z',
    encoder: { libvipsVersion: '8.18.6', name: 'sharp', sharpVersion: '0.35.4' },
    merchantId: MERCHANT,
    policyVersion: 1,
    recipeId: RECIPE_FROZEN_R1,
    role: 'logo',
    schemaVersion: 1,
    source: {
      bytes: 23837,
      format: 'png',
      orientedHeight: 600,
      orientedWidth: 800,
      sha256: SOURCE,
    },
    tiers: logoTiers(),
  };
}

function validAcceptance() {
  return {
    assetId: 'logo-contract',
    generationId: createHash('sha256').update('contract-generation').digest('hex'),
    merchantId: MERCHANT,
    note: 'Contract review: text legible, colors preserved.',
    outputHashes: logoTiers().map((tier) => tier.sha256),
    recipeId: RECIPE_FROZEN_R1,
    reviewedAt: '2026-10-01T21:00:00.000Z',
    reviewer: 'pilot-owner',
    schemaVersion: 1,
    sourceSha256: SOURCE,
    verdict: 'accepted',
  };
}

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
    rejectedVerdict: { ...acceptance, verdict: 'rejected' },
  },
  validAcceptance: acceptance,
  validAcceptanceOffset: { ...acceptance, reviewedAt: '2026-10-01T22:00:00+01:00' },
  validManifest: manifest,
  validManifestGuarded: guarded,
  validManifestOffset: { ...manifest, createdAt: '2026-10-01T21:00:00+01:00' },
};

await writeFile(join(here, 'contract-fixtures.json'), `${JSON.stringify(fixtures, null, 2)}\n`);
console.log('wrote contract-fixtures.json');
