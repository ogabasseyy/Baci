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
import {
  loadLabConfig,
  type PilotLabConfig,
} from '@/lib/merchant-image-variant-pilot/lab-config';

// Wrap the loader so one test can gate in-flight loads and observe call
// counts; without a hook installed every call runs the real loader.
vi.mock(
  '@/lib/merchant-image-variant-pilot/lab-config',
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import('@/lib/merchant-image-variant-pilot/lab-config')
      >();
    return {
      ...original,
      loadLabConfig: (...args: unknown[]) => {
        const hookState = globalThis as unknown as {
          __pilotLabLoadHook?: (...inner: unknown[]) => Promise<unknown>;
        };
        const hook = hookState.__pilotLabLoadHook;
        if (hook) {
          return hook(...args);
        }
        return (original.loadLabConfig as (...inner: unknown[]) => unknown)(
          ...args
        );
      },
    };
  }
);

import { PILOT_RECIPE_ID } from '@/schemas/merchant-image-variant-pilot';
import {
  getLabConfig,
  parseRawAcceptances,
  parseRawInventoryRecords,
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
      // Transformer-parity hardening: length cap, control characters,
      // and encoded separators fail here, not downstream. Every
      // decode layer is validated, so nested encodings fail too.
      `${'a'.repeat(253)}.png`,
      'a\nb.png',
      'a%2flogo.png',
      'a%5clogo.png',
      'a%00.png',
      'a%252flogo.png',
      'a%25252flogo.png',
      '%2e%2e%2fescape.png',
      '..%2fescape.png',
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

  it('rejects non-object elements with input-validation errors', () => {
    for (const element of [null, 42, 'accepted', []]) {
      expect(() => parseRawAcceptances([element])).toThrow(
        /acceptances\[0\] must be an object/
      );
    }
    expect(() => parseRawAcceptances([{ verdict: 'accepted' }, null])).toThrow(
      /acceptances\[1\] must be an object/
    );
  });
});

describe('getLabConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses to load with the lab flag off, before any disk I/O', async () => {
    const lab = await setupRouteFiles();
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', lab.inputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', lab.outputRoot);
    await expect(getLabConfig()).rejects.toThrow(/outside lab mode/);
  });

  it('requires the lab roots before reading anything', async () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', '');
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', '');
    await expect(getLabConfig()).rejects.toThrow(/INPUT_ROOT/);
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

  it('reloads on frozen-input edits and pins the mtime residual', async () => {
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
    // Same-size rewrite with a pinned mtime keeps serving the cached
    // config until restart (accepted lab residual, same class as the
    // staged-verify fingerprint skip).
    await writeFile(inventoryPath, ` ${text}`);
    await utimes(inventoryPath, pinned, pinned);
    await expect(getLabConfig()).resolves.toBe(second);
  });

  it('dedupes concurrent loads per frozen input without cross-key mixups', async () => {
    const labA = await setupRouteFiles();
    const labB = await setupRouteFiles();
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    // No staging needed: the gated loader below returns canned configs
    // with empty staged sets, which verify trivially.
    const calls: string[] = [];
    let releaseA!: (config: PilotLabConfig) => void;
    let releaseB!: (config: PilotLabConfig) => void;
    const gateA = new Promise<PilotLabConfig>((resolve) => {
      releaseA = resolve;
    });
    const gateB = new Promise<PilotLabConfig>((resolve) => {
      releaseB = resolve;
    });
    const hookState = globalThis as Record<string, unknown>;
    hookState.__pilotLabLoadHook = (input: unknown) => {
      const root = (input as { inputRoot: string }).inputRoot;
      calls.push(root);
      // Each loader call resolves to a DISTINCT object, so a duplicate
      // load is observable via identity even with identical inputs.
      const gate = root === labA.inputRoot ? gateA : gateB;
      return gate.then(
        (config) =>
          ({ ...config, tag: `${root}:${calls.length}` }) as PilotLabConfig
      );
    };
    try {
      const setActiveLab = (lab: typeof labA) => {
        vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', lab.inputRoot);
        vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', lab.outputRoot);
        vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', lab.publicDir);
      };
      // A starts and stays in flight (gated loader); B arrives with a
      // different key; only then is A requested again. A single-slot
      // dedupe has deterministically evicted A by that point.
      setActiveLab(labA);
      const firstA = getLabConfig();
      await waitForLoaderCalls(calls, 1);
      setActiveLab(labB);
      const firstB = getLabConfig();
      await waitForLoaderCalls(calls, 2);
      setActiveLab(labA);
      const secondA = getLabConfig();
      // Let the second A request reach its dedupe check while A is still
      // in flight. A single-slot dedupe issues a third loader call here
      // (loop exits early); per-key dedupe stays silent (loop runs its
      // bound). The gates stay closed throughout so the cache path can
      // never mask a dedupe miss.
      for (let i = 0; i < 200 && calls.length < 3; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      releaseA({ stagedPaths: [] } as unknown as PilotLabConfig);
      releaseB({ stagedPaths: [] } as unknown as PilotLabConfig);
      const [configA, configB, configA2] = await Promise.all([
        firstA,
        firstB,
        secondA,
      ]);
      // Same frozen inputs share one in-flight load: exactly two loader
      // calls, and the second A request resolves to A's config.
      expect(calls).toHaveLength(2);
      expect(configA2).toBe(configA);
      // Different frozen inputs resolve to their own configs.
      expect(configB).not.toBe(configA);
    } finally {
      delete hookState.__pilotLabLoadHook;
    }
  });
});

async function waitForLoaderCalls(calls: readonly unknown[], count: number) {
  for (let i = 0; i < 1000 && calls.length < count; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(calls).toHaveLength(count);
}

const ROUTE_MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const ROUTE_GENERATION = 'c'.repeat(64);

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
}

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
