// Shared-contract fixture builders for make-contract-fixtures.mjs.
// Deterministic: identical inputs produce identical JSON on every run.
import { createHash } from 'node:crypto';
import { RECIPE_ID } from '../constants.mjs';

const RECIPE = RECIPE_ID;
// Frozen r1 recipe identity: delivery-less tiers are valid ONLY under a
// non-current recipe. The plain validManifest pair is the frozen r1
// legacy case; current-recipe manifests must record delivery.
const RECIPE_FROZEN_R1 = 'pilot-r1-0123456789abcdef';
const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const SOURCE = createHash('sha256').update('contract-source').digest('hex');

function tierHash(width, format) {
  return createHash('sha256').update(`tier:${width}:${format}`).digest('hex');
}

export const GUARD_SOURCE = createHash('sha256')
  .update('contract-guard-source')
  .digest('hex');
const GUARD_SOURCE_BYTES = 5000;

// Guarded r2 ladder: an avif source with mixed dispositions across one
// ladder — small rungs generated, large compatible rungs passing through,
// large webp rungs flagged over-source (avif source, webp branch).
export function guardedTiers() {
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

export function validManifestGuarded() {
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

export function logoTiers() {
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

export function validManifest() {
  return {
    assetId: 'logo-contract',
    createdAt: '2026-10-01T20:00:00.000Z',
    encoder: {
      libvipsVersion: '8.18.6',
      name: 'sharp',
      sharpVersion: '0.35.4',
    },
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

export function validAcceptance() {
  return {
    assetId: 'logo-contract',
    generationId: createHash('sha256')
      .update('contract-generation')
      .digest('hex'),
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
