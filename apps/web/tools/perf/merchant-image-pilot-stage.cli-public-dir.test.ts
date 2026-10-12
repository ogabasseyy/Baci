import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { labGenerationIdFor } from '@/lib/merchant-image-variant-pilot/lab-generation-identity';
import { PILOT_RECIPE_ID } from '@/schemas/merchant-image-variant-pilot';
import { main } from './merchant-image-pilot-stage.cli';

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
const COMMITTED_FILLERS = join(
  here,
  '..',
  '..',
  'public',
  '__pilot',
  'fillers'
);

// The startup gate hash-pins the committed filler set: plant the real
// bytes so sandbox stages satisfy the same gate staging now enforces.
async function plantCommittedFillers(sandbox: string): Promise<void> {
  const dest = join(sandbox, 'public', '__pilot', 'fillers');
  await mkdir(dest, { recursive: true });
  for (const file of await readdir(COMMITTED_FILLERS)) {
    await copyFile(join(COMMITTED_FILLERS, file), join(dest, file));
  }
}

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

async function setupStageFiles() {
  const base = await mkdtemp(join(tmpdir(), 'pilot-stage-'));
  const inputRoot = join(base, 'input');
  const outputRoot = join(base, 'output');
  const publicDir = join(base, 'public');
  await mkdir(inputRoot, { recursive: true });

  const snapshot = await readFile(join(GENERATOR_FIXTURES, 'tiny-48x48.png'));
  await writeFile(join(inputRoot, 'logo-1.png'), snapshot);
  const sourceSha256 = createHash('sha256').update(snapshot).digest('hex');
  // The loader recomputes the generation identity and rejects renamed
  // directories, so the fixture must use the real derived ID.
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
        schemaVersion: 1,
        sha256: sourceSha256,
        slot: 'header-logo',
        sourcePath: 'logo-1.png',
        url: 'https://cdn.example.com/media/logo.png',
      },
    ])
  );
  return { generationId, inputRoot, outputRoot, publicDir, tiers };
}

describe('stage main', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('treats an empty public-dir env override as unset', async () => {
    const lab = await setupStageFiles();
    const sandbox = await mkdtemp(join(tmpdir(), 'pilot-stage-pubdir-'));
    await plantCommittedFillers(sandbox);
    const cwd = process.cwd();
    const argv = process.argv;
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', '');
    process.argv = [
      'node',
      'merchant-image-pilot-stage.cli.ts',
      '--input-root',
      lab.inputRoot,
      '--output-root',
      lab.outputRoot,
    ];
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      process.chdir(sandbox);
      await main();
    } finally {
      process.chdir(cwd);
      process.argv = argv;
    }
    const summary = JSON.parse(String(log.mock.calls[0]?.[0] ?? '{}'));
    expect(summary.ok).toBe(true);
    // Falls back to <cwd>/public — never a CWD-relative '__pilot' root the
    // request loader would not read back.
    const staged = await readFile(
      join(sandbox, 'public', '__pilot', 'originals', `${MERCHANT}-logo-1.png`)
    );
    expect(staged.length).toBeGreaterThan(0);
  });

  it("treats --public-dir '' as unset", async () => {
    const lab = await setupStageFiles();
    const sandbox = await mkdtemp(join(tmpdir(), 'pilot-stage-pubflag-'));
    await plantCommittedFillers(sandbox);
    const cwd = process.cwd();
    const argv = process.argv;
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    process.argv = [
      'node',
      'merchant-image-pilot-stage.cli.ts',
      '--input-root',
      lab.inputRoot,
      '--output-root',
      lab.outputRoot,
      '--public-dir',
      '',
    ];
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      process.chdir(sandbox);
      await main();
    } finally {
      process.chdir(cwd);
      process.argv = argv;
    }
    const summary = JSON.parse(String(log.mock.calls[0]?.[0] ?? '{}'));
    expect(summary.ok).toBe(true);
    const staged = await readFile(
      join(sandbox, 'public', '__pilot', 'originals', `${MERCHANT}-logo-1.png`)
    );
    expect(staged.length).toBeGreaterThan(0);
  });

  it('fails staging when the filler set is absent', async () => {
    // No fillers planted: the startup gate would refuse this tree at
    // Next start, so staging must fail here instead of printing ok.
    const lab = await setupStageFiles();
    const sandbox = await mkdtemp(join(tmpdir(), 'pilot-stage-nofill-'));
    const cwd = process.cwd();
    const argv = process.argv;
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    process.argv = [
      'node',
      'merchant-image-pilot-stage.cli.ts',
      '--input-root',
      lab.inputRoot,
      '--output-root',
      lab.outputRoot,
    ];
    try {
      process.chdir(sandbox);
      await expect(main()).rejects.toThrow(/fillers directory/);
    } finally {
      process.chdir(cwd);
      process.argv = argv;
    }
  });
});
