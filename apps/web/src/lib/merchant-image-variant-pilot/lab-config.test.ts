import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PILOT_RECIPE_ID } from '@/schemas/merchant-image-variant-pilot';
import {
  isPilotLabEnabled,
  loadLabConfig,
  stageVerifiedTier,
} from './lab-config';

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

  it('loads read-only by default: validates, writes nothing', async () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    const lab = await setupLabFiles();
    const config = await loadLabConfig({ ...lab });
    expect(config.statuses[0]?.status).toBe('accepted');
    expect(config.stagedPaths.length).toBeGreaterThan(0);
    // No __pilot tree was created: request rendering never writes.
    await expect(stat(join(lab.publicDir, '__pilot'))).rejects.toThrow();
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

describe('stageVerifiedTier', () => {
  it('stages exactly the bytes it validated', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-stage-'));
    const sourcePath = join(dir, 'tier.avif');
    const bytes = Buffer.from('verified-tier-bytes');
    await writeFile(sourcePath, bytes);
    const destPath = join(dir, 'staged.avif');
    await stageVerifiedTier({
      destPath,
      expectedBytes: bytes.length,
      expectedSha256: createHash('sha256').update(bytes).digest('hex'),
      sourcePath,
    });
    expect(await readFile(destPath)).toEqual(bytes);
  });

  it('leaves verified-identical destinations untouched, heals drifted ones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-stage-'));
    const sourcePath = join(dir, 'tier.avif');
    const bytes = Buffer.from('verified-tier-bytes');
    await writeFile(sourcePath, bytes);
    const input = {
      expectedBytes: bytes.length,
      expectedSha256: createHash('sha256').update(bytes).digest('hex'),
      sourcePath,
    };
    // Identical dest: backdate it, restage, mtime must not move.
    const identical = join(dir, 'identical.avif');
    await writeFile(identical, bytes);
    const old = new Date('2020-01-01T00:00:00.000Z');
    await utimes(identical, old, old);
    await stageVerifiedTier({ ...input, destPath: identical });
    expect((await stat(identical)).mtimeMs).toBe(old.getTime());
    // Drifted dest: same length, different bytes → overwritten with verified.
    const drifted = join(dir, 'drifted.avif');
    const wrong = Buffer.from('VERIFIED-TIER-BYTES');
    await writeFile(drifted, wrong);
    await stageVerifiedTier({ ...input, destPath: drifted });
    expect(await readFile(drifted)).toEqual(bytes);
  });

  it('refuses to stage bytes that fail validation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-stage-'));
    const sourcePath = join(dir, 'tier.avif');
    const bytes = Buffer.from('unverified-tier-bytes');
    await writeFile(sourcePath, bytes);
    const sha = createHash('sha256').update(bytes).digest('hex');
    await expect(
      stageVerifiedTier({
        destPath: join(dir, 'bad-sha.avif'),
        expectedBytes: bytes.length,
        expectedSha256: '0'.repeat(64),
        sourcePath,
      })
    ).rejects.toThrow(/hash mismatch/);
    await expect(
      stageVerifiedTier({
        destPath: join(dir, 'bad-size.avif'),
        expectedBytes: bytes.length + 1,
        expectedSha256: sha,
        sourcePath,
      })
    ).rejects.toThrow(/byte size/);
    await expect(stat(join(dir, 'bad-sha.avif'))).rejects.toThrow();
    await expect(stat(join(dir, 'bad-size.avif'))).rejects.toThrow();
  });
});
