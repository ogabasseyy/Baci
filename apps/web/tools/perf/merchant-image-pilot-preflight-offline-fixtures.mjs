import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { RECIPE_ID } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import { generationIdFor } from '../../../../infra/cdn-transformer/pilot/generation-identity.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const GENERATOR_FIXTURES = join(
  here,
  '..',
  '..',
  '..',
  '..',
  'infra',
  'cdn-transformer',
  'pilot',
  'fixtures'
);
export const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
export const RECIPE = RECIPE_ID;
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function setupOfflineAssets(assets) {
  const base = join(
    tmpdir(),
    `pilot-preflight-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const inputRoot = join(base, 'input');
  const outputRoot = join(base, 'output');
  const publicDir = join(base, 'public');
  await mkdir(inputRoot, { recursive: true });
  await mkdir(publicDir, { recursive: true });
  const staged = [];
  for (const asset of assets) {
    const merchantId = asset.merchantId ?? MERCHANT;
    const sourcePath = `${asset.assetId}.png`;
    // 2000px-wide source: every role ladder fits without upscaling (the
    // manifest contract rejects upscaled claims), and the 4:1 aspect keeps
    // rung heights exact.
    await copyFile(
      join(GENERATOR_FIXTURES, 'wide-2000x500.png'),
      join(inputRoot, sourcePath)
    );
    const snapshot = await readFile(join(inputRoot, sourcePath));
    const sourceSha = sha256(snapshot);
    const sourceMeta = await sharp(snapshot).metadata();
    // The gate recomputes the content-derived identity (renamed
    // directories fail), so fixtures must use the real derived ID.
    const generationId = generationIdFor({
      encoderIdentity: {
        libvipsVersion: '8.18.6',
        name: 'sharp',
        sharpVersion: '0.35.4',
      },
      job: { assetId: asset.assetId, merchantId, role: asset.role },
      recipeId: RECIPE,
      sourceSha256: sourceSha,
    });
    const generationDir = join(outputRoot, 'generations', generationId);
    await mkdir(generationDir, { recursive: true });
    // Real encodings on the genuine role ladder so descriptor checks verify
    // actual decoded dimensions, not string shapes. Aspect-preserving
    // downscale; claimed geometry is read back from the decoded bytes.
    const tiers = [];
    for (const width of asset.ladder) {
      for (const format of ['avif', 'webp']) {
        const bytes = await sharp(snapshot)
          .resize(Math.min(width, sourceMeta.width))
          .toFormat(format)
          .toBuffer();
        const decoded = await sharp(bytes).metadata();
        const hash = sha256(bytes);
        const fileName = `${hash}.${format}`;
        await writeFile(join(generationDir, fileName), bytes);
        tiers.push({
          actualWidth: decoded.width,
          bytes: bytes.length,
          contentType: `image/${format}`,
          // png source: capped rungs generate, larger rungs take the
          // explicit over-source exception.
          delivery:
            bytes.length <= snapshot.length
              ? 'generated'
              : 'generated-over-source',
          format,
          height: decoded.height,
          path: fileName,
          quality: 70,
          requestedWidth: width,
          sha256: hash,
          width: decoded.width,
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
        merchantId,
        policyVersion: 1,
        recipeId: RECIPE,
        role: asset.role,
        schemaVersion: 1,
        source: {
          bytes: snapshot.length,
          format: 'png',
          orientedHeight: sourceMeta.height,
          orientedWidth: sourceMeta.width,
          sha256: sourceSha,
        },
        tiers,
      })
    );
    // Mirror the lab-config staging layout: committed bytes plus the frozen
    // original under the lab base URL.
    const stageDir = join(publicDir, '__pilot', generationId);
    await mkdir(stageDir, { recursive: true });
    for (const tier of tiers) {
      await copyFile(join(generationDir, tier.path), join(stageDir, tier.path));
    }
    const originalsDir = join(publicDir, '__pilot', 'originals');
    await mkdir(originalsDir, { recursive: true });
    const originalName = `${merchantId}-${asset.assetId}.png`;
    await copyFile(
      join(inputRoot, sourcePath),
      join(originalsDir, originalName)
    );
    staged.push({
      assetId: asset.assetId,
      generationId,
      merchantId,
      record: {
        assetId: asset.assetId,
        merchantId,
        role: asset.role,
        schemaVersion: 1,
        sha256: sourceSha,
        slot: asset.slot,
        sourcePath,
        url: asset.url,
      },
      role: asset.role,
      slot: asset.slot,
      sourceSha,
      stagedOriginal: `/__pilot/originals/${originalName}`,
      tiers,
    });
  }
  const inventoryPath = join(inputRoot, 'inventory.json');
  await writeFile(
    inventoryPath,
    JSON.stringify(staged.map((entry) => entry.record))
  );
  const acceptancesPath = join(outputRoot, 'acceptances.json');
  await writeFile(
    acceptancesPath,
    JSON.stringify(
      staged.map((entry) => ({
        assetId: entry.assetId,
        generationId: entry.generationId,
        merchantId: entry.merchantId,
        note: 'Lab review: fixture acceptance.',
        outputHashes: entry.tiers.map((tier) => tier.sha256),
        qualities: entry.tiers.map((tier) => tier.quality),
        originalUrl: entry.record.url,
        recipeId: RECIPE,
        reviewedAt: '2026-10-01T21:00:00.000Z',
        reviewer: 'pilot-owner',
        schemaVersion: 1,
        slotId: entry.slot,
        sourceSha256: entry.sourceSha,
        verdict: 'accepted',
      }))
    )
  );
  // The sample pin is mandatory: every fixture freezes its own matrix so
  // green-path runs always exercise the pinned mode.
  const samplePath = join(base, 'sample.json');
  await writeFile(
    samplePath,
    JSON.stringify(
      staged.map(
        (entry) => `${entry.merchantId}/${entry.assetId}/${entry.slot}`
      )
    )
  );
  // The fail-closed fillers gate requires the real committed filler
  // bytes: copy them from the repo public tree so the committed pins
  // verify against genuine files.
  const fillersDir = join(publicDir, '__pilot', 'fillers');
  await mkdir(fillersDir, { recursive: true });
  const committedFillers = join(
    here,
    '..',
    '..',
    'public',
    '__pilot',
    'fillers'
  );
  for (const name of [
    'grid-filler-600x400-a.png',
    'grid-filler-600x400-b.png',
    'grid-filler-600x400-c.png',
  ]) {
    await copyFile(join(committedFillers, name), join(fillersDir, name));
  }
  return {
    acceptancesPath,
    assets: staged,
    base,
    inputRoot,
    inventoryPath,
    outputRoot,
    publicDir,
    samplePath,
  };
}

export async function setupOffline() {
  const fixture = await setupOfflineAssets([
    {
      assetId: 'logo-a',
      ladder: [96, 192, 384],
      role: 'logo',
      slot: 'header-logo',
      url: 'https://cdn.example.com/media/logo-a.png',
    },
  ]);
  const [only] = fixture.assets;
  return { ...fixture, generationId: only.generationId, tiers: only.tiers };
}

export function offlineOptions(fixture, overrides = {}) {
  return {
    acceptances: fixture.acceptancesPath,
    expectSample: fixture.samplePath,
    inputRoot: fixture.inputRoot,
    inventory: fixture.inventoryPath,
    outputRoot: fixture.outputRoot,
    publicDir: fixture.publicDir,
    recipe: RECIPE,
    ...overrides,
  };
}
