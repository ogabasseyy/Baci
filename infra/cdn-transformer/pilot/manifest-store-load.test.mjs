import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

test('loadGeneration rejects symlinked generation entries before reuse', async () => {
  const first = await realLadderStaging();
  const encoderIdentity = buildEncoderIdentity();
  const recipeId = 'pilot-r1-symlink-reject';
  const generationId = generationIdFor({
    encoderIdentity,
    job: JOB,
    recipeId,
    sourceSha256: first.expectedSha256,
  });
  const manifest = validManifest({
    encoder: encoderIdentity,
    recipeId,
    source: {
      bytes: 85,
      format: 'png',
      orientedHeight: 48,
      orientedWidth: 48,
      sha256: first.expectedSha256,
    },
    tiers: first.ladder.tiers.map((tier) => ({
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
  const files = first.ladder.tiers
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
    job: { ...JOB, expectedSha256: first.expectedSha256 },
    manifest,
    outputRoot: first.root,
    stagingDir: first.stagingDir,
  });
  // Swap the committed directory for a link to an outside tree: reuse
  // must refuse, never follow it into external files.
  const outside = await mkdtemp(join(tmpdir(), 'pilot-outside-'));
  const linkPath = join(first.root, 'generations', generationId);
  await rm(linkPath, { recursive: true });
  await symlink(outside, linkPath);
  await assert.rejects(
    () => loadGeneration(first.root, generationId),
    /not a directory/
  );
  const retry = await realLadderStaging();
  await assert.rejects(
    () =>
      commitGeneration({
        files: retry.ladder.tiers
          .filter(
            (tier, index, all) =>
              all.findIndex((other) => other.path === tier.path) === index
          )
          .map((tier) => ({
            from: tier.path,
            name: outputFileName(tier.sha256, tier.format),
          })),
        generationId,
        job: { ...JOB, expectedSha256: retry.expectedSha256 },
        manifest,
        outputRoot: first.root,
        stagingDir: retry.stagingDir,
      }),
    /not a directory/
  );
});

test('loadGeneration rejects a symlinked generations root', async () => {
  // generations/ itself swapped for a link to an outside tree holding
  // a valid-looking generation dir: reuse must refuse the root instead
  // of comparing children against the external target.
  const outputRoot = await mkdtemp(join(tmpdir(), 'pilot-load-root-'));
  const outside = await mkdtemp(join(tmpdir(), 'pilot-load-out-'));
  const generationId = 'd'.repeat(64);
  await mkdir(join(outside, generationId), { recursive: true });
  await symlink(outside, join(outputRoot, 'generations'));
  await assert.rejects(
    () => loadGeneration(outputRoot, generationId),
    /generations root escapes the output root/
  );
});

test('loadGeneration rejects oversized tiers without allocating the whole file', async () => {
  const staged = await realLadderStaging();
  const encoderIdentity = buildEncoderIdentity();
  const recipeId = 'pilot-r1-oversize-reject';
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
  const victim = manifest.tiers[0].path;
  const victimPath = join(staged.root, 'generations', generationId, victim);
  const original = await readFile(victimPath);
  await writeFile(
    victimPath,
    Buffer.concat([original, Buffer.alloc(2 * 1024 * 1024)])
  );
  await assert.rejects(
    () => loadGeneration(staged.root, generationId),
    /byte size changed/
  );
});

test('loadGeneration rejects oversized manifests before parsing', async () => {
  const staged = await realLadderStaging();
  const encoderIdentity = buildEncoderIdentity();
  const recipeId = 'pilot-r1-manifest-ceiling';
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
  // A committed manifest.json replaced with a huge file rejects on size
  // instead of allocating the whole file before schema validation.
  const manifestPath = join(
    staged.root,
    'generations',
    generationId,
    'manifest.json'
  );
  await writeFile(manifestPath, Buffer.alloc(2 * 1024 * 1024, 0x7b));
  await assert.rejects(
    () => loadGeneration(staged.root, generationId),
    /size ceiling/
  );
});
