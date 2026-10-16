import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStagingBudget } from './disk-guards.mjs';
import { encodeRoleLadder } from './encoder.mjs';
import {
  buildEncoderIdentity,
  generationIdFor,
  outputFileName,
} from './manifest.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', name);

export const JOB = {
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

export function validManifest(overrides = {}) {
  return {
    assetId: JOB.assetId,
    createdAt: '2026-10-01T20:00:00.000Z',
    encoder: {
      libvipsVersion: '8.18.0',
      name: 'sharp',
      sharpVersion: '0.35.4',
    },
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

export async function realLadderStaging() {
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

export async function commitFixture(recipeId) {
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
