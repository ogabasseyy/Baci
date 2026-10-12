import assert from 'node:assert/strict';
import { readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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

test('commitGeneration atomically publishes verified encoder output', async () => {
  const { expectedSha256, ladder, root, stagingDir } =
    await realLadderStaging();
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
  const before = await stat(
    join(first.root, 'generations', generationId, 'manifest.json')
  );

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
  const after = await stat(
    join(first.root, 'generations', generationId, 'manifest.json')
  );
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
  const victimBytes = await readFile(
    join(first.root, 'generations', generationId, victim)
  );
  await writeFile(
    join(first.root, 'generations', generationId, victim),
    Buffer.alloc(victimBytes.length, 7)
  );
  await assert.rejects(
    () => loadGeneration(first.root, generationId),
    /hash mismatch/
  );
});

