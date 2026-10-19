import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
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

  it('removes stale generations and originals on restage', async () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    const lab = await setupLabFiles();
    const first = await loadLabConfig({ ...lab }, { stage: true });
    expect(first.statuses[0]?.status).toBe('accepted');
    expect(first.reconciled).toEqual([]);
    // Previous-run leftovers: a removed generation dir, a stale tier in
    // the current generation, and a stale original.
    const staleGen = join(lab.publicDir, '__pilot', 'f'.repeat(64));
    await mkdir(staleGen, { recursive: true });
    await writeFile(join(staleGen, 'stale.avif'), 'stale');
    await writeFile(
      join(lab.publicDir, '__pilot', lab.generationId, 'stale-tier.webp'),
      'stale'
    );
    await writeFile(
      join(lab.publicDir, '__pilot', 'originals', 'stale-original.png'),
      'stale'
    );
    const second = await loadLabConfig({ ...lab }, { stage: true });
    expect(second.statuses[0]?.status).toBe('accepted');
    expect([...(second.reconciled ?? [])].sort()).toEqual(
      [
        'f'.repeat(64),
        join(lab.generationId, 'stale-tier.webp'),
        join('originals', 'stale-original.png'),
      ].sort()
    );
    await expect(stat(staleGen)).rejects.toThrow();
    await expect(
      stat(join(lab.publicDir, '__pilot', lab.generationId, 'stale-tier.webp'))
    ).rejects.toThrow();
    // Current files survive the reconciliation.
    expect(second.stagedPaths.length).toBeGreaterThan(0);
    for (const entry of second.stagedPaths) {
      expect((await stat(entry.path)).isFile()).toBe(true);
    }
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

  it('stages the verified original for unaccepted bindings, tiers only when accepted', async () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    const lab = await setupLabFiles();
    const config = await loadLabConfig(
      { ...lab, acceptances: [] },
      { stage: true }
    );
    expect(config.statuses).toHaveLength(1);
    expect(config.statuses[0]?.status).toBe('missing-acceptance');
    // Out-of-coverage slots render the real control, not a placeholder:
    // the suffix is decoded from the verified bytes (no manifest to ask).
    const originalUrl = config.originalUrlFor({
      merchantId: MERCHANT,
      slotId: 'header-logo',
    });
    expect(originalUrl).toBe(`/__pilot/originals/${MERCHANT}-logo-1.png`);
    if (originalUrl === null) {
      throw new Error('expected a staged original URL');
    }
    expect((await stat(join(lab.publicDir, originalUrl))).isFile()).toBe(true);
    // No derivative activation without acceptance: only the original path.
    expect(config.stagedPaths).toHaveLength(1);
    expect(config.stagedPaths[0]?.path).toContain('originals');
  });

  it('skips the original when unaccepted bytes fail hash verification', async () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    const lab = await setupLabFiles();
    await writeFile(join(lab.inputRoot, 'logo-1.png'), Buffer.from('tampered'));
    const config = await loadLabConfig(
      { ...lab, acceptances: [] },
      { stage: true }
    );
    // Unverifiable bytes fail open into the not-optimized row (null
    // original), not into a control the freeze cannot vouch for — and the
    // load itself still succeeds for the remaining bindings.
    expect(
      config.originalUrlFor({ merchantId: MERCHANT, slotId: 'header-logo' })
    ).toBeNull();
    expect(config.stagedPaths).toHaveLength(0);
  });
});
