import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEncoderIdentity,
  generationIdFor,
  outputFileName,
} from './manifest.mjs';
import { commitGeneration, loadGeneration } from './manifest-store.mjs';
import {
  JOB,
  realLadderStaging,
  validManifest,
} from './manifest-store-fixtures.mjs';

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
    .map((tier) => ({
      from: tier.path,
      name: outputFileName(tier.sha256, tier.format),
    }));

  const unsupported = (code) =>
    Object.assign(new Error(`fsync ${code}`), { code });
  const degraded = await commitGeneration({
    deps: {
      fsyncDir: () => Promise.reject(unsupported('ENOSYS')),
      fsyncFile: () => Promise.reject(unsupported('EINVAL')),
    },
    files,
    generationId,
    job: { ...JOB, expectedSha256: staged.expectedSha256 },
    manifest,
    outputRoot: staged.root,
    stagingDir: staged.stagingDir,
  });
  assert.equal(degraded.durability, 'sync-unsupported');
  assert.equal(
    (await loadGeneration(staged.root, generationId)).manifest.recipeId,
    'pilot-r1-zzz'
  );

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
          rename: () =>
            Promise.reject(new Error('simulated crash before rename')),
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
  await assert.rejects(
    () => loadGeneration(staged2.root, generationId2),
    /not published/
  );
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
          assertDeadline: () => assertJobDeadline(Date.now() - 1, 'commit'),
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

