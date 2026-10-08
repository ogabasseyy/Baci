import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { RECIPE_ID } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import { generationIdFor } from '../../../../infra/cdn-transformer/pilot/generation-identity.mjs';

export const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');
export const GENERATION = 'c'.repeat(64);

export function tierBytes(width = 48, height = 48) {
  return sharp({
    create: { background: '#1c1917', channels: 3, height, width },
  })
    .webp()
    .toBuffer();
}

export function manifestFor({
  bytes,
  format = 'webp',
  sha,
  width = 48,
  height = 48,
}) {
  return {
    assetId: 'logo-a',
    createdAt: '2026-10-01T10:00:00Z',
    encoder: { libvipsVersion: '8.16', name: 'sharp', sharpVersion: '0.34' },
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    policyVersion: 1,
    recipeId: 'pilot/r1',
    role: 'logo',
    schemaVersion: 1,
    source: {
      bytes: 100,
      format: 'png',
      orientedHeight: 48,
      orientedWidth: 48,
      sha256: 'd'.repeat(64),
    },
    tiers: [
      {
        actualWidth: width,
        bytes,
        contentType: `image/${format}`,
        delivery: 'generated',
        format,
        height,
        path: `${sha}.${format}`,
        quality: 70,
        requestedWidth: width,
        sha256: sha,
        width,
      },
    ],
  };
}

export async function outputRootWith(
  manifest,
  files = {},
  generationId = GENERATION
) {
  const root = await mkdtemp(join(tmpdir(), 'pilot-offline-output-'));
  const dir = join(root, 'generations', generationId);
  await mkdir(dir, { recursive: true });
  if (manifest) {
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
  }
  for (const [path, bytes] of Object.entries(files)) {
    await writeFile(join(dir, path), bytes);
  }
  return root;
}

export const RECORD = {
  assetId: 'logo-a',
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  role: 'logo',
  sha256: 'd'.repeat(64),
  sourcePath: 'snapshots/logo-a.png',
  url: 'https://cdn.example.com/media/logo-a.png',
};

export function acceptanceFor(hashes, generationId = GENERATION) {
  return {
    generationId,
    originalUrl: RECORD.url,
    outputHashes: hashes,
  };
}

export async function boundSourceFixture() {
  const inputBytes = await sharp({
    create: { background: '#1c1917', channels: 3, height: 288, width: 384 },
  })
    .png()
    .toBuffer();
  const sourceSha = sha256(inputBytes);
  const tiers = [];
  for (const requestedWidth of [96, 192, 384]) {
    for (const format of ['avif', 'webp']) {
      const hash = sha256(Buffer.from(`tier:${requestedWidth}:${format}`));
      tiers.push({
        actualWidth: requestedWidth,
        bytes: 100,
        contentType: `image/${format}`,
        delivery:
          inputBytes.length >= 100 ? 'generated' : 'generated-over-source',
        format,
        height: Math.round((288 * requestedWidth) / 384),
        path: `${hash}.${format}`,
        quality: 70,
        requestedWidth,
        sha256: hash,
        width: requestedWidth,
      });
    }
  }
  const manifest = {
    assetId: 'logo-a',
    createdAt: '2026-10-01T10:00:00Z',
    encoder: { libvipsVersion: '8.16', name: 'sharp', sharpVersion: '0.34' },
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    policyVersion: 1,
    recipeId: RECIPE_ID,
    role: 'logo',
    schemaVersion: 1,
    source: {
      bytes: inputBytes.length,
      format: 'png',
      orientedHeight: 288,
      orientedWidth: 384,
      sha256: sourceSha,
    },
    tiers,
  };
  // The manifest gate recomputes the content-derived identity, so the
  // fixture acceptance must reference the real derived directory.
  const generationId = generationIdFor({
    encoderIdentity: manifest.encoder,
    job: {
      assetId: manifest.assetId,
      merchantId: manifest.merchantId,
      role: manifest.role,
    },
    recipeId: manifest.recipeId,
    sourceSha256: sourceSha,
  });
  return { generationId, inputBytes, manifest, sourceSha };
}
