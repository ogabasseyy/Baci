import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStagingBudget } from './disk-guards.mjs';
import { encodeRoleLadder } from './encoder.mjs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildEncoderIdentity,
  generationIdFor,
  outputFileName,
} from './manifest.mjs';
import { commitGeneration, loadGeneration } from './manifest-store.mjs';

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
  assert.equal(reused.durability, 'synced');
  const after = await stat(join(first.root, 'generations', generationId, 'manifest.json'));
  assert.equal(after.mtimeMs, before.mtimeMs);

  // A lost durability sidecar degrades the reuse report to 'unknown',
  // never to an assumed 'synced'.
  await unlink(
    join(first.root, 'generations', generationId, 'durability.json')
  );
  const third = await realLadderStaging();
  const unknown = await commitGeneration({
    files: filesFor(third.ladder),
    generationId,
    job: boundJob,
    manifest: manifestFor(third.ladder),
    outputRoot: first.root,
    stagingDir: third.stagingDir,
  });
  assert.equal(unknown.reused, true);
  assert.equal(unknown.durability, 'unknown');

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

  const unsupported = (code) =>
    Object.assign(new Error(`fsync ${code}`), { code });
  const degraded = await commitGeneration({
    deps: {
      fsyncDir: async () => {
        throw unsupported('ENOSYS');
      },
      fsyncFile: async () => {
        throw unsupported('EINVAL');
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

  // Reuse of the degraded publish reports the persisted verdict, not 'synced'.
  const restaged = await realLadderStaging();
  const reused = await commitGeneration({
    files: restaged.ladder.tiers
      .filter(
        (tier, index, all) =>
          all.findIndex((other) => other.path === tier.path) === index
      )
      .map((tier) => ({
        from: tier.path,
        name: outputFileName(tier.sha256, tier.format),
      })),
    generationId,
    job: { ...JOB, expectedSha256: staged.expectedSha256 },
    manifest,
    outputRoot: staged.root,
    stagingDir: restaged.stagingDir,
  });
  assert.equal(reused.reused, true);
  assert.equal(reused.durability, 'sync-unsupported');

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

test('commitGeneration refuses to publish past the job deadline', async () => {
  const { assertJobDeadline } = await import('./generate-job.mjs');
  const staged = await realLadderStaging();
  const encoderIdentity = buildEncoderIdentity();
  const generationId = generationIdFor({
    encoderIdentity,
    job: JOB,
    recipeId: 'pilot-r1-deadline',
    sourceSha256: staged.expectedSha256,
  });
  const manifest = validManifest({
    encoder: encoderIdentity,
    recipeId: 'pilot-r1-deadline',
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
    .map((tier) => ({
      from: tier.path,
      name: outputFileName(tier.sha256, tier.format),
    }));
  // Verification and the fsync loop run first; the expired deadline must
  // abort before the visibility rename, leaving nothing published.
  await assert.rejects(
    () =>
      commitGeneration({
        deps: {
          assertDeadline: () =>
            assertJobDeadline(Date.now() - 1, 'commit'),
        },
        files,
        generationId,
        job: { ...JOB, expectedSha256: staged.expectedSha256 },
        manifest,
        outputRoot: staged.root,
        stagingDir: staged.stagingDir,
      }),
    /budget during commit/
  );
  await assert.rejects(
    () => loadGeneration(staged.root, generationId),
    /not published/
  );
});

async function commitFixture(recipeId) {
  const staged = await realLadderStaging();
  const encoderIdentity = buildEncoderIdentity();
  const generationId = generationIdFor({
    encoderIdentity,
    job: JOB,
    recipeId,
    sourceSha256: staged.expectedSha256,
  });
  const manifest = validManifest({
    encoder: encoderIdentity,
    recipeId,
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
    .map((tier) => ({
      from: tier.path,
      name: outputFileName(tier.sha256, tier.format),
    }));
  return {
    files,
    generationId,
    job: { ...JOB, expectedSha256: staged.expectedSha256 },
    manifest,
    root: staged.root,
    stagingDir: staged.stagingDir,
  };
}

test('commitGeneration aborts on genuine pre-commit fsync errors', async () => {
  const fixture = await commitFixture('pilot-r1-syncfail');
  // ENOSPC surfacing at fsync time is a storage failure, not an
  // unsupported filesystem: refuse to publish.
  await assert.rejects(
    () =>
      commitGeneration({
        deps: {
          fsyncFile: async () => {
            throw Object.assign(new Error('no space'), { code: 'ENOSPC' });
          },
        },
        files: fixture.files,
        generationId: fixture.generationId,
        job: fixture.job,
        manifest: fixture.manifest,
        outputRoot: fixture.root,
        stagingDir: fixture.stagingDir,
      }),
    (error) =>
      error.code === 'sync-failed' && /refusing to publish/.test(error.message)
  );
  await assert.rejects(
    () => loadGeneration(fixture.root, fixture.generationId),
    /not published/
  );
});

test('commitGeneration unpublishes on post-commit directory fsync errors', async () => {
  const fixture = await commitFixture('pilot-r1-syncfaildir');
  // Only the post-rename generations-dir fsync fails: the rename is
  // already visible, so the commit must remove it before reporting
  // failed — never failed-but-published.
  await assert.rejects(
    () =>
      commitGeneration({
        deps: {
          fsyncDir: async (path) => {
            if (path.endsWith('generations')) {
              throw Object.assign(new Error('io error'), { code: 'EIO' });
            }
          },
        },
        files: fixture.files,
        generationId: fixture.generationId,
        job: fixture.job,
        manifest: fixture.manifest,
        outputRoot: fixture.root,
        stagingDir: fixture.stagingDir,
      }),
    (error) => error.code === 'sync-failed' && /unpublished/.test(error.message)
  );
  await assert.rejects(
    () => loadGeneration(fixture.root, fixture.generationId),
    /not published/
  );
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
