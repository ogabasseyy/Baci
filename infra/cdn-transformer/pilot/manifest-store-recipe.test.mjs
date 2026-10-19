import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createStagingBudget } from './disk-guards.mjs';
import { buildDisposition } from './generate-disposition.mjs';
import { currentRecipeId } from './generation-identity.mjs';
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

test('commitGeneration refuses to activate a stale-recipe manifest', async () => {
  // Frozen r1 shape: legacy recipe id with delivery-less tiers. It
  // parses (the legacy exemption keeps it schema-valid) but must never
  // activate under the current recipe — plant it with real tier bytes
  // at the current generation id and prove the reuse comparison
  // rejects it instead of serving legacy bytes as current.
  const first = await realLadderStaging();
  const encoderIdentity = buildEncoderIdentity();
  const recipeId = currentRecipeId();
  const boundJob = { ...JOB, expectedSha256: first.expectedSha256 };
  const snapshot = { bytes: await readFile(first.snapshotPath) };
  const generationId = generationIdFor({
    encoderIdentity,
    job: JOB,
    recipeId,
    sourceSha256: first.expectedSha256,
  });
  const plant = await buildDisposition({
    encoderIdentity,
    job: boundJob,
    ladder: first.ladder,
    recipeId,
    snapshot,
    stagingBudget: createStagingBudget(),
    stagingDir: first.stagingDir,
  });
  const plantDir = join(first.root, 'generations', generationId);
  await mkdir(plantDir, { recursive: true });
  const stale = {
    ...plant.manifest,
    recipeId: 'pilot-r1-0123456789abcdef',
    tiers: plant.manifest.tiers.map((tier) => {
      const { delivery, ...rest } = tier;
      return rest;
    }),
  };
  await writeFile(join(plantDir, 'manifest.json'), JSON.stringify(stale));
  for (const file of plant.files) {
    await copyFile(file.from, join(plantDir, file.name));
  }
  // Fresh encodes are deterministic, so the second staging carries the
  // same tier bytes: only the planted manifest's stale recipe differs.
  const second = await realLadderStaging();
  const fresh = await buildDisposition({
    encoderIdentity,
    job: boundJob,
    ladder: second.ladder,
    recipeId,
    snapshot,
    stagingBudget: createStagingBudget(),
    stagingDir: second.stagingDir,
  });
  await assert.rejects(
    () =>
      commitGeneration({
        files: fresh.files,
        generationId,
        job: boundJob,
        manifest: fresh.manifest,
        outputRoot: first.root,
        stagingDir: second.stagingDir,
      }),
    (error) =>
      error.code === 'generation-misbound' &&
      /identity does not match/.test(error.message)
  );
});

test('commitGeneration refuses reuse when retained bytes differ', async () => {
  // Same identity (encoder versions, recipe, source) but different lossy
  // bytes: a generation directory reused or copied from another codec
  // build or architecture. The job reports the freshly encoded tiers,
  // so reusing the retained bytes would certify output the gate never
  // saw — the commit fails closed instead of reusing.
  const first = await realLadderStaging();
  const encoderIdentity = buildEncoderIdentity();
  const recipeId = 'pilot-r1-0123456789abcdef';
  const generationId = generationIdFor({
    encoderIdentity,
    job: JOB,
    recipeId,
    sourceSha256: first.expectedSha256,
  });
  const manifestFor = (tiers) =>
    validManifest({
      encoder: encoderIdentity,
      source: {
        bytes: 85,
        format: 'png',
        orientedHeight: first.ladder.source.orientedHeight,
        orientedWidth: first.ladder.source.orientedWidth,
        sha256: first.expectedSha256,
      },
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
    manifest: manifestFor(ladderTiers),
    outputRoot: first.root,
    stagingDir: first.stagingDir,
  });
  // Foreign bytes for rung 0 under the same identity: a fresh encode
  // (the first commit renamed its staged files away) with one rung
  // perturbed, plus a matching fresh manifest — staged verification
  // passes, so only the retained-vs-fresh ladder comparison may refuse
  // the reuse.
  const second = await realLadderStaging();
  const rung = second.ladder.tiers[0];
  const foreignBytes = Buffer.from(await readFile(rung.path));
  foreignBytes[foreignBytes.length - 1] ^= 0xff;
  const foreignSha = createHash('sha256').update(foreignBytes).digest('hex');
  const foreignPath = join(second.stagingDir, 'foreign-rung-0');
  await writeFile(foreignPath, foreignBytes);
  const foreignTiers = ladderTiers.map((entry, index) =>
    index === 0
      ? {
          ...entry,
          bytes: foreignBytes.length,
          path: outputFileName(foreignSha, entry.format),
          sha256: foreignSha,
        }
      : entry
  );
  const before = await stat(
    join(first.root, 'generations', generationId, 'manifest.json')
  );
  await assert.rejects(
    () =>
      commitGeneration({
        files: filesFor(foreignTiers, (entry) =>
          entry.sha256 === foreignSha
            ? foreignPath
            : second.ladder.tiers.find((tier) => tier.sha256 === entry.sha256)
                .path
        ),
        generationId,
        job: boundJob,
        manifest: manifestFor(foreignTiers),
        outputRoot: first.root,
        stagingDir: second.stagingDir,
      }),
    (error) =>
      error.code === 'generation-misbound' && /bytes differ/.test(error.message)
  );
  const after = await stat(
    join(first.root, 'generations', generationId, 'manifest.json')
  );
  assert.equal(after.mtimeMs, before.mtimeMs);
});

