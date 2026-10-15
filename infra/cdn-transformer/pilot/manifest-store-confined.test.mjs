import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

test('commitGeneration refuses a planted commit-manifest symlink without touching its target', async () => {
  // commit/manifest.json planted as a link inside an existing commit dir:
  // a pathname write would follow it and overwrite the external target
  // (and the later byte re-read would then pass against the attacker's
  // file), so the exclusive confined create must refuse instead.
  const staging = await realLadderStaging();
  const encoderIdentity = buildEncoderIdentity();
  const generationId = generationIdFor({
    encoderIdentity,
    job: JOB,
    recipeId: 'pilot-r1-confined-manifest',
    sourceSha256: staging.expectedSha256,
  });
  const manifest = validManifest({
    encoder: encoderIdentity,
    recipeId: 'pilot-r1-confined-manifest',
    source: {
      bytes: 85,
      format: 'png',
      orientedHeight: staging.ladder.source.orientedHeight,
      orientedWidth: staging.ladder.source.orientedWidth,
      sha256: staging.expectedSha256,
    },
    tiers: staging.ladder.tiers.map((tier) => ({
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
  const outside = join(
    await mkdtemp(join(tmpdir(), 'pilot-manifest-out-')),
    'precious.json'
  );
  await writeFile(outside, '{"precious":true}');
  await mkdir(join(staging.stagingDir, 'commit'), { recursive: true });
  await symlink(outside, join(staging.stagingDir, 'commit', 'manifest.json'));
  await assert.rejects(
    () =>
      commitGeneration({
        files: staging.ladder.tiers
          .filter(
            (tier, index, all) =>
              all.findIndex((other) => other.path === tier.path) === index
          )
          .map((tier) => ({
            from: tier.path,
            name: outputFileName(tier.sha256, tier.format),
          })),
        generationId,
        job: { ...JOB, expectedSha256: staging.expectedSha256 },
        manifest,
        outputRoot: staging.root,
        stagingDir: staging.stagingDir,
      }),
    /commit manifest appeared before the write/
  );
  assert.equal(await readFile(outside, 'utf8'), '{"precious":true}');
});
