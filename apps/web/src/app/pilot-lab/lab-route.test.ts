import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PILOT_RECIPE_ID } from '@/schemas/merchant-image-variant-pilot';
import {
  getLabConfig,
  labRequestOrigin,
  parseRawAcceptances,
  parseRawInventoryRecords,
  verifyStagedPaths,
} from './lab-route';

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

const RECORD = {
  assetId: 'logo-a',
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  role: 'logo',
  sha256: 'd'.repeat(64),
  slot: 'header-logo',
  sourcePath: 'logo-a.png',
  url: 'https://cdn.example.com/media/logo-a.png',
};

describe('parseRawInventoryRecords', () => {
  it('passes through well-formed records', () => {
    expect(parseRawInventoryRecords([RECORD])).toEqual([RECORD]);
    expect(
      parseRawInventoryRecords([
        { ...RECORD, sourcePath: 'nested/dir/logo-a.png' },
      ])
    ).toHaveLength(1);
  });

  it('rejects non-arrays and malformed records with input-validation errors', () => {
    expect(() => parseRawInventoryRecords({})).toThrow(/must be an array/);
    expect(() => parseRawInventoryRecords([null])).toThrow(/inventory\[0\]/);
    expect(() =>
      parseRawInventoryRecords([{ ...RECORD, merchantId: 7 }])
    ).toThrow(/inventory\[0\].merchantId/);
    expect(() =>
      parseRawInventoryRecords([{ ...RECORD, assetId: undefined }])
    ).toThrow(/inventory\[0\].assetId/);
  });

  it('rejects missing, non-string, and unsafe source paths', () => {
    expect(() =>
      parseRawInventoryRecords([{ ...RECORD, sourcePath: undefined }])
    ).toThrow(/inventory\[0\].sourcePath/);
    expect(() =>
      parseRawInventoryRecords([{ ...RECORD, sourcePath: 42 }])
    ).toThrow(/inventory\[0\].sourcePath/);
    expect(() =>
      parseRawInventoryRecords([{ ...RECORD, sourcePath: '' }])
    ).toThrow(/inventory\[0\].sourcePath/);
    for (const sourcePath of [
      '../escape.png',
      'a/../../escape.png',
      '/abs/logo.png',
      'a\\b.png',
      './logo.png',
    ]) {
      expect(() =>
        parseRawInventoryRecords([{ ...RECORD, sourcePath }])
      ).toThrow(/safe relative path/);
    }
  });
});

describe('parseRawAcceptances', () => {
  it('requires an array and passes elements through for schema parsing', () => {
    expect(() => parseRawAcceptances({})).toThrow(/must be an array/);
    expect(parseRawAcceptances([{ verdict: 'accepted' }])).toHaveLength(1);
  });
});

describe('verifyStagedPaths', () => {
  it('passes when every staged path exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-staged-ok-'));
    const file = join(dir, 'tier.avif');
    await writeFile(file, 'bytes');
    await expect(verifyStagedPaths([file])).resolves.toBeUndefined();
  });

  it('fails closed naming the operator fix when files go missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-staged-missing-'));
    await expect(verifyStagedPaths([join(dir, 'gone.avif')])).rejects.toThrow(
      /pilot:stage and restart/
    );
  });
});

describe('getLabConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('requires the lab roots before reading anything', async () => {
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', '');
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', '');
    await expect(getLabConfig()).rejects.toThrow(/INPUT_ROOT/);
  });

  it('fails the cached path when staged bytes go missing', async () => {
    const lab = await setupRouteFiles();
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', lab.inputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', lab.outputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', lab.publicDir);
    const first = await getLabConfig();
    expect(first.stagedPaths.length).toBeGreaterThan(0);
    // Same frozen inputs: the second load takes the cached path.
    const second = await getLabConfig();
    expect(second).toBe(first);
    // Delete one staged tier: the cache must fail closed instead of
    // serving URLs for 404 bytes.
    await rm(first.stagedPaths[0] as string);
    await expect(getLabConfig()).rejects.toThrow(/pilot:stage and restart/);
  });
});

const ROUTE_MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const ROUTE_GENERATION = 'c'.repeat(64);

async function setupRouteFiles() {
  const base = await mkdtemp(join(tmpdir(), 'pilot-route-'));
  const inputRoot = join(base, 'input');
  const outputRoot = join(base, 'output');
  const publicDir = join(base, 'public');
  const generationDir = join(outputRoot, 'generations', ROUTE_GENERATION);
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
  await writeFile(
    join(generationDir, 'manifest.json'),
    JSON.stringify({
      assetId: 'logo-1',
      createdAt: '2026-10-01T20:00:00.000Z',
      encoder: {
        libvipsVersion: '8.18.6',
        name: 'sharp',
        sharpVersion: '0.35.4',
      },
      merchantId: ROUTE_MERCHANT,
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
    })
  );
  await writeFile(
    join(outputRoot, 'acceptances.json'),
    JSON.stringify([
      {
        assetId: 'logo-1',
        generationId: ROUTE_GENERATION,
        merchantId: ROUTE_MERCHANT,
        note: 'Lab review passed.',
        outputHashes: tiers.map((tier) => tier.sha256),
        recipeId: PILOT_RECIPE_ID,
        reviewedAt: '2026-10-01T21:00:00.000Z',
        reviewer: 'pilot-owner',
        schemaVersion: 1,
        sourceSha256,
        verdict: 'accepted',
      },
    ])
  );
  await writeFile(
    join(inputRoot, 'inventory.json'),
    JSON.stringify([
      {
        assetId: 'logo-1',
        merchantId: ROUTE_MERCHANT,
        role: 'logo',
        sha256: sourceSha256,
        slot: 'header-logo',
        sourcePath: 'logo-1.png',
        url: 'https://cdn.example.com/media/logo.png',
      },
    ])
  );
  return { inputRoot, outputRoot, publicDir };
}

describe('labRequestOrigin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reflects loopback hosts with the first proto token', () => {
    expect(labRequestOrigin({ host: 'localhost:3122', proto: 'http' })).toBe(
      'http://localhost:3122'
    );
    expect(
      labRequestOrigin({ host: '127.0.0.1:3122', proto: 'HTTPS, http' })
    ).toBe('https://127.0.0.1:3122');
    expect(labRequestOrigin({ host: 'LOCALHOST', proto: null })).toBe(
      'http://localhost'
    );
  });

  it('never reflects non-loopback hosts', () => {
    // Attacker-controlled Host must not reach rendered image URLs, even
    // normalized: untrusted hosts fall back to loopback.
    for (const host of [
      'shop.example:3101',
      'shop.example',
      'Shop.Example/evil',
      'evil.com',
      'localhost.evil.com',
    ]) {
      expect(labRequestOrigin({ host, proto: 'https' })).toBe(
        'http://localhost:3000'
      );
    }
    expect(labRequestOrigin({ host: null, proto: 'https' })).toBe(
      'http://localhost:3000'
    );
    expect(labRequestOrigin({ host: 'not a host!!', proto: 'https' })).toBe(
      'http://localhost:3000'
    );
  });

  it('prefers the operator origin override when valid', () => {
    vi.stubEnv('BACI_IMAGE_PILOT_ORIGIN', 'https://lab-assets.example/cdn');
    expect(labRequestOrigin({ host: 'evil.com', proto: 'http' })).toBe(
      'https://lab-assets.example'
    );
  });

  it('ignores a malformed origin override', () => {
    for (const override of ['notaurl', 'ftp://lab.example', '']) {
      vi.stubEnv('BACI_IMAGE_PILOT_ORIGIN', override);
      expect(labRequestOrigin({ host: 'evil.com', proto: 'http' })).toBe(
        'http://localhost:3000'
      );
    }
  });
});
