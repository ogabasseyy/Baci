import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
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

test('loadGeneration rejects FIFO entries instead of blocking on them', async () => {
  // mkfifo exists only on POSIX; the loader guard itself is portable.
  if (process.platform === 'win32') {
    return;
  }
  const staged = await realLadderStaging();
  const encoderIdentity = buildEncoderIdentity();
  const recipeId = 'pilot-r1-fifo-reject';
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
  await commitGeneration({
    files,
    generationId,
    job: { ...JOB, expectedSha256: staged.expectedSha256 },
    manifest,
    outputRoot: staged.root,
    stagingDir: staged.stagingDir,
  });
  const dir = join(staged.root, 'generations', generationId);
  // A FIFO where the manifest belongs: open() would wait for a writer
  // forever, so the loader must refuse before opening. Restore after.
  const manifestPath = join(dir, 'manifest.json');
  const manifestBytes = await readFile(manifestPath);
  await rm(manifestPath);
  execFileSync('mkfifo', [manifestPath]);
  await assert.rejects(
    () => loadGeneration(staged.root, generationId),
    /not a regular file/
  );
  await rm(manifestPath);
  await writeFile(manifestPath, manifestBytes);
  // Same for a published tier: corruption, never a hang.
  const tierPath = join(dir, files[0].name);
  await rm(tierPath);
  execFileSync('mkfifo', [tierPath]);
  await assert.rejects(
    () => loadGeneration(staged.root, generationId),
    /not a regular file/
  );
  await rm(tierPath);
});
