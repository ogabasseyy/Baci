import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, symlink } from 'node:fs/promises';
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
    .map((tier) => ({
      from: tier.path,
      name: outputFileName(tier.sha256, tier.format),
    }));
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
  const jobB = {
    ...JOB,
    assetId: 'logo-2',
    expectedSha256: staged.expectedSha256,
  };
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
      .map((tier) => ({
        from: tier.path,
        name: outputFileName(tier.sha256, tier.format),
      })),
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
  const manifest = validManifest({
    merchantId: 'de968340-de02-4aa8-95f9-9d5f7d2b1f20',
  });
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

test('commitGeneration refuses planted commit and generations symlinks', async () => {
  const { mkdir, readdir, symlink } = await import('node:fs/promises');
  async function committable() {
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
    const files = ladder.tiers
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
      job: { ...JOB, expectedSha256 },
      manifest,
      outputRoot: root,
      stagingDir,
    };
  }
  const codeIs = (code) => (error) => {
    assert.equal(error?.code, code);
    return true;
  };
  // A planted staging/commit symlink would sail through recursive
  // creation and push the renames outside the output root.
  {
    const commit = await committable();
    const outside = await mkdtemp(join(tmpdir(), 'pilot-outside-'));
    await symlink(outside, join(commit.stagingDir, 'commit'));
    await assert.rejects(
      () => commitGeneration(commit),
      codeIs('unsafe-commit-directory')
    );
    assert.deepEqual(await readdir(outside), []);
  }
  // A planted generations symlink would publish the generation outside
  // the output root at the visibility rename.
  {
    const commit = await committable();
    const outside = await mkdtemp(join(tmpdir(), 'pilot-outside-'));
    await mkdir(join(outside, 'trap'), { recursive: true });
    await symlink(join(outside, 'trap'), join(commit.outputRoot, 'generations'));
    await assert.rejects(
      () => commitGeneration(commit),
      codeIs('unsafe-generations-directory')
    );
    assert.deepEqual(await readdir(join(outside, 'trap')), []);
  }
});
