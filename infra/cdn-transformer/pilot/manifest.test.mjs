import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildEncoderIdentity,
  generationIdFor,
  outputFileName,
  parsePilotManifest,
} from './manifest.mjs';

const JOB = {
  assetId: 'logo-1',
  expectedSha256: '0'.repeat(64),
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  role: 'logo',
  schemaVersion: 1,
  sourcePath: 'logo-1.png',
};

function tierEntry(overrides = {}) {
  return {
    actualWidth: 96,
    bytes: 1000,
    contentType: 'image/avif',
    format: 'avif',
    height: 64,
    path: `${'a'.repeat(64)}.avif`,
    quality: 70,
    requestedWidth: 96,
    sha256: 'a'.repeat(64),
    width: 96,
    ...overrides,
  };
}

function logoTiers() {
  const tiers = [];
  for (const requestedWidth of [96, 192, 384]) {
    for (const format of ['avif', 'webp']) {
      const sha = createHash('sha256')
        .update(`${requestedWidth}:${format}`)
        .digest('hex');
      tiers.push(
        tierEntry({
          actualWidth: requestedWidth,
          contentType: `image/${format}`,
          format,
          path: `${sha}.${format}`,
          requestedWidth,
          sha256: sha,
          width: requestedWidth,
        })
      );
    }
  }
  return tiers;
}

function validManifest(overrides = {}) {
  return {
    assetId: JOB.assetId,
    createdAt: '2026-10-01T20:00:00.000Z',
    encoder: { libvipsVersion: '8.18.0', name: 'sharp', sharpVersion: '0.35.4' },
    merchantId: JOB.merchantId,
    policyVersion: 1,
    recipeId: 'pilot-r1-0123456789abcdef',
    role: 'logo',
    schemaVersion: 1,
    source: {
      bytes: 1234,
      format: 'png',
      orientedHeight: 600,
      orientedWidth: 800,
      sha256: 'b'.repeat(64),
    },
    tiers: logoTiers(),
    ...overrides,
  };
}

test('parsePilotManifest accepts a complete manifest', () => {
  const result = parsePilotManifest(validManifest());
  assert.equal(result.ok, true);
  assert.equal(result.manifest.tiers.length, 6);
});

test('parsePilotManifest rejects malformed manifests strictly', () => {
  assert.equal(parsePilotManifest({ ...validManifest(), extra: 1 }).ok, false);
  assert.equal(
    parsePilotManifest(validManifest({ tiers: logoTiers().slice(0, 5) })).ok,
    false
  );
  assert.equal(
    parsePilotManifest(validManifest({ tiers: [...logoTiers(), tierEntry()] })).ok,
    false
  );
  for (const path of [
    '../escape.avif',
    'https://example.com/x.avif',
    'tier.avif?x=1',
    'short.avif',
    `${'a'.repeat(64)}.jpeg`,
    `${'A'.repeat(64)}.avif`,
  ]) {
    const tiers = logoTiers();
    tiers[0] = { ...tiers[0], path };
    assert.equal(parsePilotManifest(validManifest({ tiers })).ok, false, path);
  }
  const mismatched = logoTiers();
  mismatched[0] = { ...mismatched[0], sha256: 'c'.repeat(64) };
  assert.equal(parsePilotManifest(validManifest({ tiers: mismatched })).ok, false);
});

test('generated tiers stay capped at source bytes', () => {
  // tier[0] is the 96/avif rung of an 800x600 source: geometry-valid
  // height is round(600*96/800) = 72.
  const above = logoTiers();
  above[0] = { ...above[0], bytes: 1235, delivery: 'generated', height: 72 };
  const rejected = parsePilotManifest(validManifest({ tiers: above }));
  assert.equal(rejected.ok, false);
  assert.match(rejected.issues.join('\n'), /above the source bytes/);
  const capped = logoTiers();
  capped[0] = { ...capped[0], bytes: 1234, delivery: 'generated', height: 72 };
  assert.equal(parsePilotManifest(validManifest({ tiers: capped })).ok, true);
});

test('generated-over-source is an explicit over-source exception, not a cap', () => {
  // Above-source bytes with an incompatible source codec are ACCEPTED:
  // the disposition names the limitation instead of claiming a cap.
  const over = logoTiers();
  over[0] = {
    ...over[0],
    // Above the 1234-byte source but within the 5000-byte rung ceiling.
    bytes: 2000,
    delivery: 'generated-over-source',
    height: 72,
  };
  assert.equal(parsePilotManifest(validManifest({ tiers: over })).ok, true);
  // But the exception must actually hold: at/below-source bytes cannot
  // claim it.
  const notOver = logoTiers();
  notOver[0] = {
    ...notOver[0],
    bytes: 1234,
    delivery: 'generated-over-source',
    height: 72,
  };
  const cappedClaim = parsePilotManifest(validManifest({ tiers: notOver }));
  assert.equal(cappedClaim.ok, false);
  assert.match(
    cappedClaim.issues.join('\n'),
    /over-source limitation that does not hold/
  );
  // Same-codec sources cannot claim it either (pass-through was available).
  const avifSource = {
    bytes: 1234,
    format: 'avif',
    orientedHeight: 600,
    orientedWidth: 800,
    sha256: 'b'.repeat(64),
  };
  const sameCodec = logoTiers();
  sameCodec[0] = {
    ...sameCodec[0],
    bytes: 2000,
    delivery: 'generated-over-source',
    height: 72,
  };
  assert.equal(
    parsePilotManifest(validManifest({ source: avifSource, tiers: sameCodec }))
      .ok,
    false
  );
  // Cross-codec above-source tiers against that avif source stay accepted.
  const crossCodec = logoTiers();
  crossCodec[1] = {
    ...crossCodec[1],
    bytes: 2000,
    delivery: 'generated-over-source',
    height: 72,
  };
  assert.equal(
    parsePilotManifest(validManifest({ source: avifSource, tiers: crossCodec }))
      .ok,
    true
  );
});

test('generation identity isolates tenants, assets, sources, and recipes', () => {
  const base = {
    encoderIdentity: { libvipsVersion: '8.18.0', name: 'sharp', sharpVersion: '0.35.4' },
    job: JOB,
    recipeId: 'pilot-r1-0123456789abcdef',
    sourceSha256: 'b'.repeat(64),
  };
  const first = generationIdFor(base);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(generationIdFor(base), first);
  // Identical source bytes under a different asset id must not collide.
  assert.notEqual(
    generationIdFor({ ...base, job: { ...JOB, assetId: 'logo-2' } }),
    first
  );
  assert.notEqual(
    generationIdFor({
      ...base,
      job: { ...base.job, merchantId: 'de968340-de02-4aa8-95f9-9d5f7d2b1f20' },
    }),
    first
  );
  assert.notEqual(generationIdFor({ ...base, sourceSha256: 'c'.repeat(64) }), first);
  assert.notEqual(generationIdFor({ ...base, recipeId: 'pilot-r1-fedcba9876543210' }), first);
  assert.notEqual(
    generationIdFor({
      ...base,
      encoderIdentity: { ...base.encoderIdentity, sharpVersion: '0.35.5' },
    }),
    first
  );
});

test('outputFileName binds the content hash and format', () => {
  assert.equal(outputFileName('a'.repeat(64), 'avif'), `${'a'.repeat(64)}.avif`);
  assert.throws(() => outputFileName('short', 'avif'), /sha256/);
  assert.throws(() => outputFileName('a'.repeat(64), 'jpeg'), /format/);
});

test('buildEncoderIdentity reports the pinned toolchain', () => {
  const identity = buildEncoderIdentity();
  assert.equal(identity.name, 'sharp');
  assert.equal(identity.sharpVersion, '0.35.4');
  assert.ok(identity.libvipsVersion.length > 0);
});

test('parsePilotManifest binds tier geometry to the ladder and source', async () => {
  const { parsePilotManifest: parse } = await import('./manifest.mjs');
  const withTier = (index, patch) => {
    const tiers = logoTiers();
    tiers[index] = { ...tiers[index], ...patch };
    return validManifest({ tiers });
  };
  // A hash-consistent 1px claim for a 96 rung is a misbound manifest.
  assert.match(
    JSON.stringify(parse(withTier(0, { actualWidth: 1, width: 1 })).issues ?? []),
    /ladder binds 96/
  );
  // Upscaling past the request is rejected even below the source width.
  assert.equal(parse(withTier(0, { actualWidth: 192, width: 192 })).ok, false);
  // Pass-through reuses source bytes, so its width is the source width
  // even above the request — and nothing else.
  const webpSource = {
    bytes: 1234,
    format: 'webp',
    orientedHeight: 600,
    orientedWidth: 800,
    sha256: 'b'.repeat(64),
  };
  const webpTiers = logoTiers();
  webpTiers[1] = {
    ...webpTiers[1],
    actualWidth: 800,
    bytes: 1234,
    delivery: 'original-passthrough',
    height: 600,
    path: `${'b'.repeat(64)}.webp`,
    quality: null,
    sha256: 'b'.repeat(64),
    width: 800,
  };
  assert.equal(
    parse(validManifest({ source: webpSource, tiers: webpTiers })).ok,
    true
  );
  const narrowTiers = logoTiers();
  narrowTiers[1] = {
    ...narrowTiers[1],
    actualWidth: 96,
    bytes: 1234,
    delivery: 'original-passthrough',
    height: 600,
    path: `${'b'.repeat(64)}.webp`,
    quality: null,
    sha256: 'b'.repeat(64),
    width: 96,
  };
  assert.match(
    JSON.stringify(
      parse(validManifest({ source: webpSource, tiers: narrowTiers })).issues ??
        []
    ),
    /ladder binds 800/
  );
});
