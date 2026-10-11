import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createStagingBudget } from './disk-guards.mjs';
import { buildDisposition } from './generate-disposition.mjs';
import { currentRecipeId } from './generation-identity.mjs';
import { outputFileName } from './manifest.mjs';

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const SOURCE = '0'.repeat(64);

function ladder() {
  return {
    source: { format: 'webp', orientedHeight: 48, orientedWidth: 48 },
    tiers: [
      {
        actualWidth: 48,
        bytes: 400,
        contentType: 'image/avif',
        format: 'avif',
        height: 48,
        path: '/staging/tier-1.avif',
        quality: 70,
        requestedWidth: 48,
        sha256: '1'.repeat(64),
        width: 48,
      },
      {
        actualWidth: 48,
        bytes: 1500,
        contentType: 'image/webp',
        format: 'webp',
        height: 48,
        path: '/staging/tier-2.webp',
        quality: 70,
        requestedWidth: 48,
        sha256: '2'.repeat(64),
        width: 48,
      },
    ],
  };
}

test('buildDisposition assembles the manifest and commit file list', async () => {
  const stagingDir = await mkdtemp(join(tmpdir(), 'pilot-disposition-'));
  const snapshot = { bytes: Buffer.alloc(1000, 7) };
  const job = {
    assetId: 'logo-1',
    expectedSha256: SOURCE,
    merchantId: MERCHANT,
    role: 'logo',
  };
  const { files, manifest } = await buildDisposition({
    encoderIdentity: {
      libvipsVersion: '8.18.6',
      name: 'sharp',
      sharpVersion: '0.35.4',
    },
    job,
    ladder: ladder(),
    recipeId: currentRecipeId(),
    snapshot,
    stagingBudget: createStagingBudget(),
    stagingDir,
  });
  // Smaller rung generates; larger compatible rung passes the source through.
  assert.deepEqual(
    manifest.tiers.map((tier) => tier.delivery),
    ['generated', 'original-passthrough']
  );
  assert.equal(manifest.assetId, 'logo-1');
  assert.equal(manifest.source.sha256, SOURCE);
  assert.equal(manifest.source.bytes, 1000);
  // Pass-through reuses the validated source bytes under the source hash.
  assert.equal(manifest.tiers[1].path, outputFileName(SOURCE, 'webp'));
  assert.deepEqual(
    files.map((file) => file.name).sort(),
    [
      outputFileName('1'.repeat(64), 'avif'),
      outputFileName(SOURCE, 'webp'),
    ].sort()
  );
  // The pass-through copy is staged from the snapshot, never re-read.
  const staged = files.find((file) => file.name.endsWith('.webp')).from;
  assert.equal(staged, join(stagingDir, 'passthrough.webp'));
  assert.deepEqual(await readFile(staged), snapshot.bytes);
});

test('buildDisposition dedupes commit files shared across rungs', async () => {
  const stagingDir = await mkdtemp(join(tmpdir(), 'pilot-disposition-dedupe-'));
  const base = ladder();
  // Two rungs sharing one encoded file commit once.
  base.tiers[1] = { ...base.tiers[0], requestedWidth: 96 };
  const snapshot = { bytes: Buffer.alloc(1000, 7) };
  const { files, manifest } = await buildDisposition({
    encoderIdentity: {
      libvipsVersion: '8.18.6',
      name: 'sharp',
      sharpVersion: '0.35.4',
    },
    job: {
      assetId: 'logo-1',
      expectedSha256: SOURCE,
      merchantId: MERCHANT,
      role: 'logo',
    },
    ladder: base,
    recipeId: currentRecipeId(),
    snapshot,
    stagingBudget: createStagingBudget(),
    stagingDir,
  });
  assert.equal(manifest.tiers.length, 2);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, outputFileName('1'.repeat(64), 'avif'));
});
