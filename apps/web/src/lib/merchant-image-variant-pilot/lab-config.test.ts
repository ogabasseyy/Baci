import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PILOT_RECIPE_ID } from '@/schemas/merchant-image-variant-pilot';
import { isPilotLabEnabled, loadLabConfig } from './lab-config';

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
const GENERATION_ID = 'c'.repeat(64);

async function setupLabFiles() {
  const base = join(
    tmpdir(),
    `pilot-config-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const inputRoot = join(base, 'input');
  const outputRoot = join(base, 'output');
  const publicDir = join(base, 'public');
  const generationDir = join(outputRoot, 'generations', GENERATION_ID);
  await mkdir(generationDir, { recursive: true });
  await mkdir(inputRoot, { recursive: true });

  const snapshot = await readFile(join(GENERATOR_FIXTURES, 'tiny-48x48.png'));
  await writeFile(join(inputRoot, 'logo-1.png'), snapshot);
  const sourceSha256 = createHash('sha256').update(snapshot).digest('hex');

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
    generationId: GENERATION_ID,
    merchantId: MERCHANT,
    note: 'Lab review passed.',
    outputHashes: tiers.map((tier) => tier.sha256),
    recipeId: PILOT_RECIPE_ID,
    reviewedAt: '2026-10-01T21:00:00.000Z',
    reviewer: 'pilot-owner',
    schemaVersion: 1,
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
    inputRoot,
    inventoryRecords,
    outputRoot,
    publicDir,
  };
}

describe('isPilotLabEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is enabled only with the explicit lab flag', () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    expect(isPilotLabEnabled()).toBe(false);
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    expect(isPilotLabEnabled()).toBe(true);
  });
});

describe('loadLabConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses to load outside lab mode', async () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    const lab = await setupLabFiles();
    await expect(loadLabConfig({ ...lab })).rejects.toThrow(/lab mode/);
  });

  it('validates, indexes, and stages derivatives plus originals same-origin', async () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    const lab = await setupLabFiles();
    const config = await loadLabConfig({ ...lab }, { stage: true });
    expect(config.statuses).toHaveLength(1);
    expect(config.statuses[0]?.status).toBe('accepted');
    expect(config.baseUrl).toBe('/__pilot');
    // Every approved output is staged under the lab base URL path.
    const staged = join(lab.publicDir, '__pilot', GENERATION_ID);
    expect((await stat(staged)).isDirectory()).toBe(true);
    // The original bytes are staged for the same-origin control arm.
    const originalUrl = config.originalUrlFor({
      merchantId: MERCHANT,
      slotId: 'header-logo',
    });
    if (originalUrl === null) {
      throw new Error('expected a staged original URL');
    }
    expect(originalUrl).toMatch(/^\/__pilot\/originals\//);
    const originalFile = join(lab.publicDir, originalUrl);
    expect((await stat(originalFile)).isFile()).toBe(true);
    // Unknown slots stay on the mounted original renderer (null, not staged).
    expect(
      config.originalUrlFor({ merchantId: MERCHANT, slotId: 'nope' })
    ).toBeNull();
  });

  it('stages the original suffix from the verified format, not the filename', async () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    const lab = await setupLabFiles();
    // PNG bytes under a lying .jpg inventory name: the staged suffix must
    // describe the bytes (the served MIME gate pins to it), not the name.
    const lying = join(lab.inputRoot, 'photo.jpg');
    await writeFile(lying, await readFile(join(lab.inputRoot, 'logo-1.png')));
    lab.inventoryRecords[0] = {
      ...lab.inventoryRecords[0],
      sourcePath: 'photo.jpg',
    };
    const config = await loadLabConfig({ ...lab }, { stage: true });
    expect(config.statuses[0]?.status).toBe('accepted');
    const originalUrl = config.originalUrlFor({
      merchantId: MERCHANT,
      slotId: 'header-logo',
    });
    if (originalUrl === null) {
      throw new Error('expected a staged original URL');
    }
    expect(originalUrl).toBe(`/__pilot/originals/${MERCHANT}-logo-1.png`);
    expect((await stat(join(lab.publicDir, originalUrl))).isFile()).toBe(true);
  });

  it('loads read-only by default: validates, writes nothing', async () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    const lab = await setupLabFiles();
    const config = await loadLabConfig({ ...lab });
    expect(config.statuses[0]?.status).toBe('accepted');
    expect(config.stagedPaths.length).toBeGreaterThan(0);
    // No __pilot tree was created: request rendering never writes.
    await expect(stat(join(lab.publicDir, '__pilot'))).rejects.toThrow();
  });

  it('rejects an accepted manifest whose source dims the snapshot disproves', async () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    const lab = await setupLabFiles();
    const manifestPath = join(
      lab.outputRoot,
      'generations',
      GENERATION_ID,
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
      GENERATION_ID,
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
      GENERATION_ID,
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
