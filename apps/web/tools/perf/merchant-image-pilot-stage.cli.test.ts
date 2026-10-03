import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PILOT_RECIPE_ID } from '@/schemas/merchant-image-variant-pilot';
import { main, parseStageArgs } from './merchant-image-pilot-stage.cli';

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

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const GENERATION_ID = 'c'.repeat(64);

async function setupStageFiles() {
  const base = await mkdtemp(join(tmpdir(), 'pilot-stage-'));
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
    })
  );
  await writeFile(
    join(outputRoot, 'acceptances.json'),
    JSON.stringify([
      {
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
      },
    ])
  );
  await writeFile(
    join(inputRoot, 'inventory.json'),
    JSON.stringify([
      {
        assetId: 'logo-1',
        merchantId: MERCHANT,
        role: 'logo',
        sha256: sourceSha256,
        slot: 'header-logo',
        sourcePath: 'logo-1.png',
        url: 'https://cdn.example.com/media/logo.png',
      },
    ])
  );
  return { inputRoot, outputRoot, publicDir, tiers };
}

describe('parseStageArgs', () => {
  it('reads space-separated roots and ignores unknown flags', () => {
    expect(
      parseStageArgs([
        '--input-root',
        'in',
        '--output-root',
        'out',
        '--public-dir',
        'pub',
      ])
    ).toEqual({ inputRoot: 'in', outputRoot: 'out', publicDir: 'pub' });
    expect(parseStageArgs([])).toEqual({
      inputRoot: undefined,
      outputRoot: undefined,
      publicDir: undefined,
    });
    expect(parseStageArgs(['--input-root'])).toEqual({
      inputRoot: undefined,
      outputRoot: undefined,
      publicDir: undefined,
    });
  });
});

describe('stage main', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('stages verified tiers plus originals before server start', async () => {
    const lab = await setupStageFiles();
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    const argv = process.argv;
    process.argv = [
      'node',
      'merchant-image-pilot-stage.cli.ts',
      '--input-root',
      lab.inputRoot,
      '--output-root',
      lab.outputRoot,
      '--public-dir',
      lab.publicDir,
    ];
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await main();
    } finally {
      process.argv = argv;
    }
    const summary = JSON.parse(String(log.mock.calls[0]?.[0] ?? '{}'));
    expect(summary).toMatchObject({
      acceptedBindings: 1,
      baseUrl: '/__pilot',
      generationIds: [GENERATION_ID],
      ok: true,
    });
    for (const tier of lab.tiers) {
      const staged = await readFile(
        join(
          lab.publicDir,
          '__pilot',
          GENERATION_ID,
          `${tier.sha256}.${tier.format}`
        )
      );
      expect(staged.length).toBe(tier.bytes);
    }
    const original = await readFile(
      join(lab.publicDir, '__pilot', 'originals', `${MERCHANT}-logo-1.png`)
    );
    expect(original.length).toBeGreaterThan(0);
  });

  it('fails closed without the lab flag or roots', async () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', '');
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', '');
    const argv = process.argv;
    process.argv = ['node', 'merchant-image-pilot-stage.cli.ts'];
    try {
      await expect(main()).rejects.toThrow();
    } finally {
      process.argv = argv;
    }
  });
});
