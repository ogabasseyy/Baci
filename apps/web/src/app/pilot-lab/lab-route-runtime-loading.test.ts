import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PilotLabConfig } from '@/lib/merchant-image-variant-pilot/lab-config';

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

import { labGenerationIdFor } from '@/lib/merchant-image-variant-pilot/lab-generation-identity';
import { PILOT_RECIPE_ID } from '@/schemas/merchant-image-variant-pilot';
import { loadLabConfigAtStartup as getLabConfig } from './lab-route';

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
