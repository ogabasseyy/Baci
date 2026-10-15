import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PILOT_RECIPE_ID } from '@/schemas/merchant-image-variant-pilot';
import { loadLabConfig } from './lab-config';
import { labGenerationIdFor } from './lab-generation-identity';

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

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

async function setupLabFiles() {
  const base = join(
    tmpdir(),
    `pilot-config-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const inputRoot = join(base, 'input');
  const outputRoot = join(base, 'output');
  const publicDir = join(base, 'public');
  const snapshot = await readFile(join(GENERATOR_FIXTURES, 'tiny-48x48.png'));
  await mkdir(inputRoot, { recursive: true });
  await writeFile(join(inputRoot, 'logo-1.png'), snapshot);
  const sourceSha256 = createHash('sha256').update(snapshot).digest('hex');
  // The bound recipe output for this fixture job: buildLabIndex
  // recomputes it and rejects renamed directories.
  const generationId = labGenerationIdFor({
    assetId: 'logo-1',
    encoderIdentity: {
      libvipsVersion: '8.18.6',
      name: 'sharp',
      sharpVersion: '0.35.4',
    },
    merchantId: MERCHANT,
    recipeId: PILOT_RECIPE_ID,
    role: 'logo',
    sourceSha256,
  });
  const generationDir = join(outputRoot, 'generations', generationId);
  await mkdir(generationDir, { recursive: true });

  const tiers = [];
  for (const requestedWidth of [96, 192, 384]) {
    for (const format of ['avif', 'webp'] as const) {
      const bytes = Buffer.concat([
        snapshot,
        Buffer.from(`${requestedWidth}${format}`),
      ]);
      const hash = createHash('sha256').update(bytes).digest('hex');
      const fileName = `${hash}.${format}`;
      await writeFile(join(generationDir, fileName), bytes);
      tiers.push({
        actualWidth: 48,
        bytes: bytes.length,
        contentType: `image/${format}`,
        // Synthetic tiers exceed the snapshot bytes from a png source:
        // the explicit over-source exception (never forced into a cap).
        delivery: 'generated-over-source',
        format,
        height: 48,
        path: fileName,
        quality: 70,
        requestedWidth,
        sha256: hash,
        width: 48,
      });
    }
  }
  const manifest = {
    assetId: 'logo-1',
    createdAt: '2026-10-01T20:00:00.000Z',
    encoder: {
      libvipsVersion: '8.18.6',
      name: 'sharp',
      sharpVersion: '0.35.4',
    },
    merchantId: MERCHANT,
    policyVersion: 1,
    recipeId: PILOT_RECIPE_ID,
    role: 'logo',
    schemaVersion: 1,
    source: {
      bytes: snapshot.length,
      format: 'png',
      orientedHeight: 48,
      orientedWidth: 48,
      sha256: sourceSha256,
    },
    tiers,
  };
  await writeFile(
    join(generationDir, 'manifest.json'),
    JSON.stringify(manifest)
  );
  const acceptance = {
    assetId: 'logo-1',
    generationId,
    merchantId: MERCHANT,
    note: 'Lab review passed.',
    outputHashes: tiers.map((tier) => tier.sha256),
    qualities: tiers.map((tier) => tier.quality),
    originalUrl: 'https://cdn.example.com/media/logo.png',
    recipeId: PILOT_RECIPE_ID,
    reviewedAt: '2026-10-01T21:00:00.000Z',
    reviewer: 'pilot-owner',
    schemaVersion: 1,
    slotId: 'header-logo',
    sourceSha256,
    verdict: 'accepted',
  };
  const inventoryRecords = [
    {
      assetId: 'logo-1',
      merchantId: MERCHANT,
      role: 'logo',
      slot: 'header-logo',
      url: 'https://cdn.example.com/media/logo.png',
      sha256: sourceSha256,
      sourcePath: 'logo-1.png',
      schemaVersion: 1,
    },
  ];
  return {
    acceptances: [acceptance],
    generationId,
    inputRoot,
    inventoryRecords,
    outputRoot,
    publicDir,
  };
}

describe('loadLabConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('hides the absolute input root when it is unresolvable', async () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    const lab = await setupLabFiles();
    const missing = join(
      lab.inputRoot,
      `missing-root-${Math.random().toString(36).slice(2)}`
    );
    // The raw ENOENT carries the absolute operator path; the loader must
    // fail with a path-free input error instead.
    const error = await loadLabConfig({
      ...lab,
      inputRoot: missing,
    }).then(
      () => {
        throw new Error('expected loadLabConfig to reject');
      },
      (cause: unknown) => cause as Error
    );
    expect(error.message).toMatch(/input root is not accessible/);
    expect(error.message).not.toContain('missing-root');
  });

  it('rejects an accepted manifest whose source dims the snapshot disproves', async () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    const lab = await setupLabFiles();
    const manifestPath = join(
      lab.outputRoot,
      'generations',
      lab.generationId,
      'manifest.json'
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    // The 48x48 snapshot is untouched (hash still matches); only the
    // claimed height lies — by 1px, inside the schema's aspect tolerance,
    // so the manifest still builds an accepted index and only the
    // snapshot decode can catch it.
    manifest.source.orientedHeight = 49;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(loadLabConfig({ ...lab })).rejects.toThrow(
      /48x48.*claims 48x49/
    );
  });

  it('rejects an accepted manifest whose source format the snapshot disproves', async () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    const lab = await setupLabFiles();
    const manifestPath = join(
      lab.outputRoot,
      'generations',
      lab.generationId,
      'manifest.json'
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    // 'jpeg' differs from both encoded tier formats, so the schema's
    // over-source format check still passes — only the decode catches it.
    manifest.source.format = 'jpeg';
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(loadLabConfig({ ...lab })).rejects.toThrow(
      /decodes as "png" but the accepted manifest claims "jpeg"/
    );
  });

  it('rejects conflicting duplicate acceptances instead of staging a subset', async () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    const lab = await setupLabFiles();
    const first = lab.acceptances[0];
    if (!first) {
      throw new Error('expected a fixture acceptance');
    }
    const conflict = { ...first, verdict: 'rejected' };
    await expect(
      loadLabConfig({ ...lab, acceptances: [...lab.acceptances, conflict] })
    ).rejects.toThrow(/duplicate acceptances .* conflict/);
  });

  it('rejects malformed acceptance records instead of staging a subset', async () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    const lab = await setupLabFiles();
    await expect(
      loadLabConfig({
        ...lab,
        acceptances: [...lab.acceptances, { verdict: 'accepted' }],
      })
    ).rejects.toThrow(/invalid acceptances/);
  });

  it('rejects an accepted manifest whose source bytes the snapshot disproves', async () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    const lab = await setupLabFiles();
    const manifestPath = join(
      lab.outputRoot,
      'generations',
      lab.generationId,
      'manifest.json'
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    // A shrunken byte claim keeps every over-source inequality true, so
    // the manifest still builds an accepted index.
    manifest.source.bytes = 10;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(loadLabConfig({ ...lab })).rejects.toThrow(
      /claims 48x48 \(10 B\)/
    );
  });

  it('confines snapshots to the input root and verifies frozen bytes', async () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    const lab = await setupLabFiles();
    const traversal = {
      ...lab,
      inventoryRecords: [
        { ...lab.inventoryRecords[0], sourcePath: '../escape.png' },
      ],
    };
    await expect(loadLabConfig(traversal)).rejects.toThrow(
      /escapes the input root/
    );

    await writeFile(join(lab.inputRoot, 'logo-1.png'), Buffer.from('tampered'));
    await expect(loadLabConfig({ ...lab })).rejects.toThrow(
      /differ from the frozen hash/
    );
  });
});
