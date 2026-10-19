import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildEncoderIdentity,
  generationIdFor,
  outputFileName,
} from './manifest.mjs';
import { commitGeneration } from './manifest-store.mjs';
import {
  JOB,
  realLadderStaging,
  validManifest,
} from './manifest-store-fixtures.mjs';

test('commitGeneration refuses reuse when retained source facts differ', async () => {
  // Same identity (encoder versions, recipe, source hash) and identical
  // tiers, but the requested source claims one more byte than the
  // retained manifest: schema-valid (every tier stays below the claim)
  // yet different source facts than the snapshot just verified, so the
  // generation must not report a successful reuse.
  const first = await realLadderStaging();
  const encoderIdentity = buildEncoderIdentity();
  const recipeId = 'pilot-r1-0123456789abcdef';
  const generationId = generationIdFor({
    encoderIdentity,
    job: JOB,
    recipeId,
    sourceSha256: first.expectedSha256,
  });
  const sourceFor = (bytes) => ({
    bytes,
    format: 'png',
    orientedHeight: first.ladder.source.orientedHeight,
    orientedWidth: first.ladder.source.orientedWidth,
    sha256: first.expectedSha256,
  });
  const manifestFor = (tiers, bytes) =>
    validManifest({
      encoder: encoderIdentity,
      source: sourceFor(bytes),
      tiers,
    });
  const ladderTiers = first.ladder.tiers.map((tier) => ({
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
  }));
  const filesFor = (entries, fromFor) =>
    entries.map((entry) => ({ from: fromFor(entry), name: entry.path }));
  const boundJob = { ...JOB, expectedSha256: first.expectedSha256 };
  await commitGeneration({
    files: filesFor(
      ladderTiers,
      (entry) =>
        first.ladder.tiers.find((tier) => tier.sha256 === entry.sha256).path
    ),
    generationId,
    job: boundJob,
    manifest: manifestFor(ladderTiers, 85),
    outputRoot: first.root,
    stagingDir: first.stagingDir,
  });
  const second = await realLadderStaging();
  const before = await stat(
    join(first.root, 'generations', generationId, 'manifest.json')
  );
  // Fresh encodes are deterministic, so the second staging carries the
  // same tier bytes: only the requested source byte count differs.
  await assert.rejects(
    () =>
      commitGeneration({
        files: filesFor(
          ladderTiers,
          (entry) =>
            second.ladder.tiers.find((tier) => tier.sha256 === entry.sha256)
              .path
        ),
        generationId,
        job: boundJob,
        manifest: manifestFor(ladderTiers, 86),
        outputRoot: first.root,
        stagingDir: second.stagingDir,
      }),
    (error) =>
      error.code === 'generation-misbound' &&
      /identity does not match/.test(error.message)
  );
  const after = await stat(
    join(first.root, 'generations', generationId, 'manifest.json')
  );
  assert.equal(after.mtimeMs, before.mtimeMs);
});

test('commitGeneration surfaces reuse-path staging cleanup failures', async () => {
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
  // The second commit reuses the published generation; its staging
  // removal fails transiently. The error must surface (not strand a
  // directory on every reuse) while reuse still reports success.
  const second = await realLadderStaging();
  const reused = await commitGeneration({
    deps: {
      removeOwnedStaging: () =>
        Promise.reject(
          Object.assign(new Error('staging busy'), { code: 'EBUSY' })
        ),
    },
    files: filesFor(second.ladder),
    generationId,
    job: boundJob,
    manifest: manifestFor(second.ladder),
    outputRoot: first.root,
    stagingDir: second.stagingDir,
  });
  assert.equal(reused.reused, true);
  assert.match(reused.stagingCleanupError, /EBUSY/);
  assert.match(reused.stagingCleanupError, /published and reusable/);
});

