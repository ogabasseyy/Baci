import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLabConfig } from '@/lib/merchant-image-variant-pilot/lab-config';
import { labGenerationIdFor } from '@/lib/merchant-image-variant-pilot/lab-generation-identity';
import { PILOT_RECIPE_ID } from '@/schemas/merchant-image-variant-pilot';
import {
  loadLabConfigAtStartup as getLabConfig,
  getLabConfig as getRequestLabConfig,
  initializeLabRuntime,
  parseRawAcceptances,
  parseRawInventoryRecords,
} from './lab-route';
import { seedCommittedFillers } from './lab-test-roots';

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

describe('getLabConfig', () => {
  afterEach(() => {
    Reflect.deleteProperty(
      globalThis,
      Symbol.for('baci.merchant-image-pilot.runtime')
    );
    vi.unstubAllEnvs();
  });

  it('serves frozen inputs but fails closed when staged bytes vanish', async () => {
    const lab = await setupRouteFiles();
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', lab.inputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', lab.outputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', lab.publicDir);
    await expect(getRequestLabConfig()).rejects.toThrow(/startup validation/);
    await stageRouteFiles(lab);
    await initializeLabRuntime();
    const first = await getRequestLabConfig();
    // Operator roots are frozen into the snapshot: their post-start
    // disappearance changes nothing about what the lab serves.
    await rm(lab.inputRoot, { recursive: true });
    await rm(lab.outputRoot, { recursive: true });
    await expect(getRequestLabConfig()).resolves.toBe(first);
    // Staged bytes are served live from disk by Next: a post-start
    // deletion must fail closed (re-stage + restart) instead of
    // rendering URLs for 404s until the next restart.
    await rm(lab.publicDir, { recursive: true });
    await expect(getRequestLabConfig()).rejects.toThrow(
      /pilot:stage and restart/
    );
  });

  it('fails closed when a file is planted after boot', async () => {
    // Next serves public/__pilot statically without invoking lab
    // handlers, so a file planted after boot is servable until the
    // next lab page render — at which point the per-request binding
    // check must refuse instead of serving it alongside bound bytes.
    const lab = await setupRouteFiles();
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', lab.inputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', lab.outputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', lab.publicDir);
    await stageRouteFiles(lab);
    await initializeLabRuntime();
    const first = await getRequestLabConfig();
    expect(first.stagedPaths.length).toBeGreaterThan(0);
    const generationDir = dirname(first.stagedPaths[0]?.path as string);
    await writeFile(join(generationDir, 'planted.png'), 'planted bytes');
    await expect(getRequestLabConfig()).rejects.toThrow(
      /has no inventory binding/
    );
  });

  it('fails closed on unstaged bytes, then serves once staged', async () => {
    const lab = await setupRouteFiles();
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', lab.inputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', lab.outputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', lab.publicDir);
    // Fresh load with nothing staged: the read-only loader refuses to
    // write and fails with the operator fix (stage + restart).
    await expect(getLabConfig()).rejects.toThrow(/pilot:stage and restart/);
    // The pre-start step stages (default load stages); routes then serve.
    await stageRouteFiles(lab);
    const first = await getLabConfig();
    expect(first.stagedPaths.length).toBeGreaterThan(0);
    // Same frozen inputs: the second load takes the cached path.
    const second = await getLabConfig();
    expect(second).toBe(first);
    // Delete one staged tier: the cache must fail closed instead of
    // serving URLs for 404 bytes.
    const [deleted] = first.stagedPaths;
    await rm(deleted?.path as string);
    await expect(getLabConfig()).rejects.toThrow(/pilot:stage and restart/);
  });

  it('reloads on frozen-input edits, even same-size same-mtime rewrites', async () => {
    const lab = await setupRouteFiles();
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', lab.inputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', lab.outputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', lab.publicDir);
    await stageRouteFiles(lab);
    const first = await getLabConfig();
    const inventoryPath = join(lab.inputRoot, 'inventory.json');
    // Size-changing edit invalidates the fingerprint key: full reload.
    const text = await readFile(inventoryPath, 'utf8');
    await writeFile(inventoryPath, `${text} `);
    // Synthetic ms-quantized mtime: raw stat mtimes carry sub-ms
    // fractions that utimes cannot round-trip exactly.
    const afterEdit = await stat(inventoryPath);
    const pinned = new Date(afterEdit.mtimeMs + 2000);
    await utimes(inventoryPath, pinned, pinned);
    const second = await getLabConfig();
    expect(second).not.toBe(first);
    // Same-size rewrite with a pinned mtime still reloads: the write
    // itself bumps ctime, which the fingerprint binds, so utimens
    // cannot hide an operator edit behind a frozen mtime.
    await writeFile(inventoryPath, ` ${text}`);
    await utimes(inventoryPath, pinned, pinned);
    const third = await getLabConfig();
    expect(third).not.toBe(second);
  });
});

const ROUTE_MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

async function stageRouteFiles(lab: {
  inputRoot: string;
  outputRoot: string;
  publicDir: string;
}) {
  const inventoryText = await readFile(
    join(lab.inputRoot, 'inventory.json'),
    'utf8'
  );
  const acceptancesText = await readFile(
    join(lab.outputRoot, 'acceptances.json'),
    'utf8'
  );
  await loadLabConfig(
    {
      acceptances: parseRawAcceptances(JSON.parse(acceptancesText)),
      inputRoot: lab.inputRoot,
      inventoryRecords: parseRawInventoryRecords(JSON.parse(inventoryText)),
      outputRoot: lab.outputRoot,
      publicDir: lab.publicDir,
    },
    { stage: true }
  );
  await seedCommittedFillers(lab.publicDir);
}

async function setupRouteFiles() {
  const base = await mkdtemp(join(tmpdir(), 'pilot-route-'));
  const inputRoot = join(base, 'input');
  const outputRoot = join(base, 'output');
  const publicDir = join(base, 'public');
  await mkdir(inputRoot, { recursive: true });

  const snapshot = await readFile(join(GENERATOR_FIXTURES, 'tiny-48x48.png'));
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
    merchantId: ROUTE_MERCHANT,
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
        // Synthetic tiers exceed the 85-byte snapshot from a png source:
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
        generationId,
        merchantId: ROUTE_MERCHANT,
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
        merchantId: ROUTE_MERCHANT,
        role: 'logo',
        schemaVersion: 1,
        sha256: sourceSha256,
        slot: 'header-logo',
        sourcePath: 'logo-1.png',
        url: 'https://cdn.example.com/media/logo.png',
      },
    ])
  );
  return { inputRoot, outputRoot, publicDir };
}
