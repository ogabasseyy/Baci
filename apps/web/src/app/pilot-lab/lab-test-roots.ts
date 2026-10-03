import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PILOT_RECIPE_ID } from '@/schemas/merchant-image-variant-pilot';

// Shared lab-roots builder for the pilot-lab route tests (gallery + store
// pages). Stages a gitignored input root (inventory.json + source bytes),
// an output root (generation dirs with manifests + acceptances.json), and
// an empty public dir. `accepted` assets get acceptances; `unreviewed`
// assets are staged on disk but never reviewed (the reported
// not-optimized path). All hashes are computed over the staged bytes, so
// the lab-config verifier exercises its real hash checks.

export interface LabTestAsset {
  assetId: string;
  generationId: string;
  ladder: readonly number[];
  merchantId: string;
  role: 'hero' | 'logo' | 'product';
  slot: string;
  url: string;
}

export interface LabTestRoots {
  inputRoot: string;
  outputRoot: string;
  publicDir: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const GENERATOR_FIXTURES = join(
  here,
  '..',
  '..',
  '..',
  '..',
  '..',
  'infra',
  'cdn-transformer',
  'pilot',
  'fixtures'
);

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function setupLabRoots(input: {
  accepted: readonly LabTestAsset[];
  unreviewed?: readonly LabTestAsset[];
}): Promise<LabTestRoots> {
  const base = join(
    tmpdir(),
    `pilot-route-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const inputRoot = join(base, 'input');
  const outputRoot = join(base, 'output');
  const publicDir = join(base, 'public');
  await mkdir(inputRoot, { recursive: true });
  await mkdir(publicDir, { recursive: true });
  const payload = await readFile(join(GENERATOR_FIXTURES, 'tiny-48x48.png'));

  async function addAsset(asset: LabTestAsset): Promise<{
    record: Record<string, unknown>;
    tierHashes: string[];
  }> {
    const sourcePath = `${asset.assetId}.png`;
    await copyFile(
      join(GENERATOR_FIXTURES, 'tiny-48x48.png'),
      join(inputRoot, sourcePath)
    );
    const snapshot = await readFile(join(inputRoot, sourcePath));
    const sourceSha = sha256(snapshot);
    const generationDir = join(outputRoot, 'generations', asset.generationId);
    await mkdir(generationDir, { recursive: true });
    const tiers = [];
    for (const requestedWidth of asset.ladder) {
      for (const format of ['avif', 'webp'] as const) {
        const bytes = Buffer.concat([
          payload,
          Buffer.from(`${asset.assetId}${requestedWidth}${format}`),
        ]);
        const hash = sha256(bytes);
        const fileName = `${hash}.${format}`;
        await writeFile(join(generationDir, fileName), bytes);
        tiers.push({
          actualWidth: requestedWidth,
          bytes: bytes.length,
          contentType: `image/${format}`,
          format,
          height: requestedWidth,
          path: fileName,
          quality: 70,
          requestedWidth,
          sha256: hash,
          width: requestedWidth,
        });
      }
    }
    await writeFile(
      join(generationDir, 'manifest.json'),
      JSON.stringify({
        assetId: asset.assetId,
        createdAt: '2026-10-01T20:00:00.000Z',
        encoder: {
          libvipsVersion: '8.18.6',
          name: 'sharp',
          sharpVersion: '0.35.4',
        },
        merchantId: asset.merchantId,
        policyVersion: 1,
        recipeId: PILOT_RECIPE_ID,
        role: asset.role,
        schemaVersion: 1,
        source: {
          bytes: snapshot.length,
          format: 'png',
          orientedHeight: 48,
          orientedWidth: 48,
          sha256: sourceSha,
        },
        tiers,
      })
    );
    return {
      record: {
        assetId: asset.assetId,
        capturedAt: '2026-10-01T20:00:00.000Z',
        contentType: 'image/png',
        height: 48,
        merchantId: asset.merchantId,
        role: asset.role,
        schemaVersion: 1,
        sha256: sourceSha,
        size: snapshot.length,
        slot: asset.slot,
        sourcePath,
        url: asset.url,
        width: 48,
      },
      tierHashes: tiers.map((tier) => tier.sha256),
    };
  }

  const records: Record<string, unknown>[] = [];
  const acceptances: Record<string, unknown>[] = [];
  for (const asset of input.accepted) {
    const { record, tierHashes } = await addAsset(asset);
    records.push(record);
    acceptances.push({
      assetId: record.assetId,
      generationId: asset.generationId,
      merchantId: asset.merchantId,
      note: 'Lab review: fixture acceptance.',
      outputHashes: tierHashes,
      recipeId: PILOT_RECIPE_ID,
      reviewedAt: '2026-10-01T21:00:00.000Z',
      reviewer: 'pilot-owner',
      schemaVersion: 1,
      sourceSha256: record.sha256,
      verdict: 'accepted',
    });
  }
  for (const asset of (input.unreviewed ?? []) as readonly LabTestAsset[]) {
    const { record } = await addAsset(asset);
    records.push(record);
  }
  await writeFile(join(inputRoot, 'inventory.json'), JSON.stringify(records));
  await writeFile(
    join(outputRoot, 'acceptances.json'),
    JSON.stringify(acceptances)
  );
  return { inputRoot, outputRoot, publicDir };
}
