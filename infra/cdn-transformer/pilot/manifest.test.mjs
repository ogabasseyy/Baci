import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStagingBudget } from './disk-guards.mjs';
import { encodeRoleLadder } from './encoder.mjs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildEncoderIdentity,
  commitGeneration,
  generationIdFor,
  loadGeneration,
  outputFileName,
  parsePilotManifest,
} from './manifest.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', name);

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
    bytes: 6000,
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
    bytes: 6000,
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
    bytes: 6000,
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

async function realLadderStaging() {
  const root = await mkdtemp(join(tmpdir(), 'pilot-manifest-'));
  const stagingDir = join(root, 'staging-testrun');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(stagingDir, { recursive: true });
  const snapshotPath = fixture('tiny-48x48.png');
  const expectedSha256 = createHash('sha256')
    .update(await readFile(snapshotPath))
    .digest('hex');
  const ladder = await encodeRoleLadder({
    deadlineMs: Date.now() + 120_000,
    expectedSha256,
    role: 'logo',
    snapshotPath,
    stagingBudget: createStagingBudget(),
    stagingDir,
  });
  return { expectedSha256, ladder, root, snapshotPath, stagingDir };
}

test('commitGeneration atomically publishes verified encoder output', async () => {
  const { expectedSha256, ladder, root, stagingDir } = await realLadderStaging();
  const encoderIdentity = buildEncoderIdentity();
  const generationId = generationIdFor({
    encoderIdentity,
    job: JOB,
    recipeId: 'pilot-r1-0123456789abcdef',
    sourceSha256: expectedSha256,
  });
  const manifest = validManifest({
    assetId: JOB.assetId,
    encoder: encoderIdentity,
    merchantId: JOB.merchantId,
    source: {
      bytes: 85,
      format: 'png',
      orientedHeight: ladder.source.orientedHeight,
      orientedWidth: ladder.source.orientedWidth,
      sha256: expectedSha256,
    },
    tiers: ladder.tiers.map((tier) => ({
      actualWidth: tier.actualWidth,
      bytes: tier.bytes,
      contentType: tier.contentType,
      format: tier.format,
      height: tier.height,
      path: outputFileName(tier.sha256, tier.format),
      quality: tier.quality,
      requestedWidth: tier.requestedWidth,
      sha256: tier.sha256,
      width: tier.width,
    })),
  });
  const committed = await commitGeneration({
    files: ladder.tiers
      .filter(
        (tier, index, all) =>
          all.findIndex((other) => other.path === tier.path) === index
      )
      .map((tier) => ({
        from: tier.path,
        name: outputFileName(tier.sha256, tier.format),
      })),
    generationId,
    job: { ...JOB, expectedSha256 },
    manifest,
    outputRoot: root,
    stagingDir,
  });
  assert.equal(committed.reused, false);
  assert.equal(committed.durability, 'synced');
  const loaded = await loadGeneration(root, generationId);
  assert.equal(loaded.manifest.tiers.length, 6);
  assert.deepEqual(
    [...new Set(loaded.manifest.tiers.map((tier) => tier.path))].sort(),
    [...new Set(manifest.tiers.map((tier) => tier.path))].sort()
  );
});

test('commitGeneration reuses validated generations and never overwrites', async () => {
  const first = await realLadderStaging();
  const encoderIdentity = buildEncoderIdentity();
  const recipeId = 'pilot-r1-0123456789abcdef';
  const generationId = generationIdFor({
    encoderIdentity,
    job: JOB,
    recipeId,
    sourceSha256: first.expectedSha256,
  });
  const manifestFor = (ladder) =>
    validManifest({
      encoder: encoderIdentity,
      source: {
        bytes: 85,
        format: 'png',
        orientedHeight: ladder.source.orientedHeight,
        orientedWidth: ladder.source.orientedWidth,
        sha256: first.expectedSha256,
      },
      tiers: ladder.tiers.map((tier) => ({
        actualWidth: tier.actualWidth,
        bytes: tier.bytes,
        contentType: tier.contentType,
        format: tier.format,
        height: tier.height,
        path: outputFileName(tier.sha256, tier.format),
        quality: tier.quality,
        requestedWidth: tier.requestedWidth,
        sha256: tier.sha256,
        width: tier.width,
      })),
    });
  const filesFor = (ladder) =>
    ladder.tiers
      .filter(
        (tier, index, all) =>
          all.findIndex((other) => other.path === tier.path) === index
      )
      .map((tier) => ({
        from: tier.path,
        name: outputFileName(tier.sha256, tier.format),
      }));
  const boundJob = { ...JOB, expectedSha256: first.expectedSha256 };
  await commitGeneration({
    files: filesFor(first.ladder),
    generationId,
    job: boundJob,
    manifest: manifestFor(first.ladder),
    outputRoot: first.root,
    stagingDir: first.stagingDir,
  });
  const before = await stat(join(first.root, 'generations', generationId, 'manifest.json'));

  const second = await realLadderStaging();
  const reused = await commitGeneration({
    files: filesFor(second.ladder),
    generationId,
    job: boundJob,
    manifest: manifestFor(second.ladder),
    outputRoot: first.root,
    stagingDir: second.stagingDir,
  });
  assert.equal(reused.reused, true);
  const after = await stat(join(first.root, 'generations', generationId, 'manifest.json'));
  assert.equal(after.mtimeMs, before.mtimeMs);

  // Tampered output invalidates the generation instead of serving bad bytes.
  const victim = manifestFor(first.ladder).tiers[0].path;
  const victimBytes = await readFile(join(first.root, 'generations', generationId, victim));
  await writeFile(
    join(first.root, 'generations', generationId, victim),
    Buffer.alloc(victimBytes.length, 7)
  );
  await assert.rejects(() => loadGeneration(first.root, generationId), /hash mismatch/);
});

test('commitGeneration degrades honestly on sync failure and fails safe on rename failure', async () => {
  const staged = await realLadderStaging();
  const encoderIdentity = buildEncoderIdentity();
  const generationId = generationIdFor({
    encoderIdentity,
    job: JOB,
    recipeId: 'pilot-r1-zzz',
    sourceSha256: staged.expectedSha256,
  });
  const manifest = validManifest({
    encoder: encoderIdentity,
    recipeId: 'pilot-r1-zzz',
    source: {
      bytes: 85,
      format: 'png',
      orientedHeight: 48,
      orientedWidth: 48,
      sha256: staged.expectedSha256,
    },
    tiers: staged.ladder.tiers.map((tier) => ({
      actualWidth: tier.actualWidth,
      bytes: tier.bytes,
      contentType: tier.contentType,
      format: tier.format,
      height: tier.height,
      path: outputFileName(tier.sha256, tier.format),
      quality: tier.quality,
      requestedWidth: tier.requestedWidth,
      sha256: tier.sha256,
      width: tier.width,
    })),
  });
  const files = staged.ladder.tiers
    .filter(
      (tier, index, all) =>
        all.findIndex((other) => other.path === tier.path) === index
    )
    .map((tier) => ({ from: tier.path, name: outputFileName(tier.sha256, tier.format) }));

  const degraded = await commitGeneration({
    deps: {
      fsyncDir: async () => {
        throw new Error('ENOSYS');
      },
      fsyncFile: async () => {
        throw new Error('ENOSYS');
      },
    },
    files,
    generationId,
    job: { ...JOB, expectedSha256: staged.expectedSha256 },
    manifest,
    outputRoot: staged.root,
    stagingDir: staged.stagingDir,
  });
  assert.equal(degraded.durability, 'sync-unsupported');
  assert.equal((await loadGeneration(staged.root, generationId)).manifest.recipeId, 'pilot-r1-zzz');

  const staged2 = await realLadderStaging();
  const generationId2 = generationIdFor({
    encoderIdentity,
    job: JOB,
    recipeId: 'pilot-r1-zzz2',
    sourceSha256: staged.expectedSha256,
  });
  await assert.rejects(
    () =>
      commitGeneration({
        deps: {
          rename: async () => {
            throw new Error('simulated crash before rename');
          },
        },
        files: staged2.ladder.tiers
          .filter(
            (tier, index, all) =>
              all.findIndex((other) => other.path === tier.path) === index
          )
          .map((tier) => ({
            from: tier.path,
            name: outputFileName(tier.sha256, tier.format),
          })),
        generationId: generationId2,
        job: { ...JOB, expectedSha256: staged.expectedSha256 },
        manifest: { ...manifest, recipeId: 'pilot-r1-zzz2' },
        outputRoot: staged2.root,
        stagingDir: staged2.stagingDir,
      }),
    /crash before rename/
  );
  // No partial generation is visible; the claim owner can diagnose staging.
  await assert.rejects(() => loadGeneration(staged2.root, generationId2), /not published/);
});

test('commitGeneration rejects a misbound existing directory without reuse', async () => {
  const staged = await realLadderStaging();
  const encoderIdentity = buildEncoderIdentity();
  const recipeId = 'pilot-r1-0123456789abcdef';
  // A valid generation for asset A, committed normally.
  const generationIdA = generationIdFor({
    encoderIdentity,
    job: JOB,
    recipeId,
    sourceSha256: staged.expectedSha256,
  });
  const manifestA = validManifest({
    encoder: encoderIdentity,
    source: {
      bytes: 85,
      format: 'png',
      orientedHeight: 48,
      orientedWidth: 48,
      sha256: staged.expectedSha256,
    },
    tiers: staged.ladder.tiers.map((tier) => ({
      actualWidth: tier.actualWidth,
      bytes: tier.bytes,
      contentType: tier.contentType,
      format: tier.format,
      height: tier.height,
      path: outputFileName(tier.sha256, tier.format),
      quality: tier.quality,
      requestedWidth: tier.requestedWidth,
      sha256: tier.sha256,
      width: tier.width,
    })),
  });
  const filesA = staged.ladder.tiers
    .filter(
      (tier, index, all) =>
        all.findIndex((other) => other.path === tier.path) === index
    )
    .map((tier) => ({ from: tier.path, name: outputFileName(tier.sha256, tier.format) }));
  await commitGeneration({
    files: filesA,
    generationId: generationIdA,
    job: { ...JOB, expectedSha256: staged.expectedSha256 },
    manifest: manifestA,
    outputRoot: staged.root,
    stagingDir: staged.stagingDir,
  });
  // The same valid bytes appear under asset B's generation directory
  // (misbound placement with fully valid hashes).
  const jobB = { ...JOB, assetId: 'logo-2', expectedSha256: staged.expectedSha256 };
  const generationIdB = generationIdFor({
    encoderIdentity,
    job: jobB,
    recipeId,
    sourceSha256: staged.expectedSha256,
  });
  const { cp } = await import('node:fs/promises');
  await cp(
    join(staged.root, 'generations', generationIdA),
    join(staged.root, 'generations', generationIdB),
    { recursive: true }
  );
  const second = await realLadderStaging();
  const manifestB = {
    ...manifestA,
    assetId: 'logo-2',
    source: { ...manifestA.source },
  };
  const error = await commitGeneration({
    files: second.ladder.tiers
      .filter(
        (tier, index, all) =>
          all.findIndex((other) => other.path === tier.path) === index
      )
      .map((tier) => ({ from: tier.path, name: outputFileName(tier.sha256, tier.format) })),
    generationId: generationIdB,
    job: jobB,
    manifest: manifestB,
    outputRoot: staged.root,
    stagingDir: second.stagingDir,
  }).catch((value) => value);
  assert.equal(error.code, 'generation-misbound');
  // The misbound directory is left untouched, never overwritten or reused.
  const loaded = await loadGeneration(staged.root, generationIdB);
  assert.equal(loaded.manifest.assetId, 'logo-1');
});

test('commitGeneration binds the manifest to the validated job', async () => {
  const staged = await realLadderStaging();
  const manifest = validManifest({ merchantId: 'de968340-de02-4aa8-95f9-9d5f7d2b1f20' });
  await assert.rejects(
    () =>
      commitGeneration({
        files: [],
        generationId: '0'.repeat(64),
        job: JOB,
        manifest,
        outputRoot: staged.root,
        stagingDir: staged.stagingDir,
      }),
    /does not match/
  );
});
