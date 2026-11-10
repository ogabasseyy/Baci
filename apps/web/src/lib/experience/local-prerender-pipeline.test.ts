import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ExperienceManifest,
  type PublicBootstrap,
  sourceDigest,
} from '@baci/shared/experience';
import { afterEach, expect, it, vi } from 'vitest';
import { createTransientOutputStore } from '../../../tools/experience-runner/transient-output-store';
import { experienceBootstrapFingerprint } from './experience-bootstrap-fingerprint';
import { createLocalPerformanceReports } from './local-performance-reports';
import { createLocalPrerenderPipeline } from './local-prerender-pipeline';
import { readExperiencePerformance } from './performance-read';
import { createPreviewVault } from './preview-service';

const authorize = vi.hoisted(() => vi.fn(async (ctx: unknown) => ctx));
vi.mock('./authorization', () => ({
  requireExperienceOwner: authorize,
  ownerRpcArgs: vi.fn(() => ({})),
}));

const directories: string[] = [];

afterEach(() => vi.unstubAllEnvs());
type PipelineSettings = Parameters<typeof createLocalPrerenderPipeline>[0];

function settings(): PipelineSettings {
  return {
    canonicalBase: 'http://127.0.0.1:4100/qa1',
    vault: createPreviewVault({
      now: Date.now,
      isActive: async () => true,
      origin: 'http://127.0.0.1:4100',
    }),
    build: {
      hostOrigin: 'http://127.0.0.1:4100',
      key: new Uint8Array(32),
      toolchainDigest: 'test-toolchain',
      transient: createTransientOutputStore(),
      recordVerifiedEvidence: vi.fn(async () => {}),
    },
    bootstrap: vi.fn(
      async (): Promise<PublicBootstrap> => ({
        route: {
          epoch: 0,
          routeId: 'home',
          params: {},
          canonicalPath: '/',
          publicDataRevision: 'test',
        },
        catalog: { products: [], revision: 'test' },
        capabilities: [],
      })
    ),
  };
}
it('uses a shared local build/owner-preview pipeline without invoking providers or owner reads on construction', () => {
  const input = settings();
  const pipeline = createLocalPrerenderPipeline(input);
  expect(pipeline.rendering).toBe('prerender-private');
  expect(typeof pipeline.finalizeBuild).toBe('function');
  expect(typeof pipeline.owner.createPreviewLaunch).toBe('function');
  expect(input.bootstrap).not.toHaveBeenCalled();
});
it('provides a read-only report lookup without invoking build or owner bootstrap', async () => {
  const input = settings();
  const pipeline = createLocalPrerenderPipeline(input);
  await expect(
    pipeline.readPerformance({
      merchantId: 'merchant',
      buildId: 'build',
      buildDigest: 'a'.repeat(64),
      sourceDigest: 'b'.repeat(64),
    })
  ).resolves.toBeUndefined();
  expect(input.bootstrap).not.toHaveBeenCalled();
});
it('treats a corrupted signed report as not-measured while preserving owner authorization checks', async () => {
  const artifactDirectory = mkdtempSync(join(tmpdir(), 'experience-pipeline-'));
  directories.push(artifactDirectory);
  const binding = {
    merchantId: 'merchant',
    buildId: 'build',
    buildDigest: 'a'.repeat(64),
    sourceDigest: 'b'.repeat(64),
  };
  const filename = `${createHash('sha256')
    .update(
      JSON.stringify([
        binding.merchantId,
        binding.buildId,
        binding.buildDigest,
        binding.sourceDigest,
      ])
    )
    .digest('hex')}.json`;
  const reportDirectory = join(artifactDirectory, 'performance');
  mkdirSync(reportDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(join(reportDirectory, filename), '{corrupted', { mode: 0o600 });

  const input = { ...settings(), artifactDirectory };
  const pipeline = createLocalPrerenderPipeline(input);
  const manifest: ExperienceManifest = {
    format: 'baci.experience/v2',
    runtime: 'react-browser-sandbox/v1',
    sdkVersion: 'commerce-bridge/v1',
    entry: 'Experience.tsx',
    files: [{ path: 'Experience.tsx', content: 'export default () => null' }],
    packages: [],
    routes: [{ path: '/', view: 'home' }],
    assets: [],
    capabilities: [],
  };
  const results = [
    { data: { build_digest: binding.buildDigest, job_id: 'job' }, error: null },
    {
      data: { source_digest: binding.sourceDigest, artifact_id: 'artifact' },
      error: null,
    },
    { data: { manifest }, error: null },
  ];
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => results.shift()),
  };
  const ctx = {
    merchantId: binding.merchantId,
    supabase: { from: vi.fn(() => query) },
  } as never;
  authorize.mockClear();

  const result = await readExperiencePerformance(
    ctx,
    binding.buildId,
    pipeline.readPerformance
  );

  expect(result).toMatchObject({
    status: 'not-measured',
    qualification: { status: 'not-measured' },
  });
  expect(authorize).toHaveBeenCalledTimes(3);
  expect(input.bootstrap).not.toHaveBeenCalled();
});
it.each([
  'home',
  'product',
] as const)('returns signed %s evidence only while its public bootstrap fingerprint is current', async (view) => {
  const canonicalPath = view === 'home' ? '/' : '/phones/product-1';
  const artifactDirectory = mkdtempSync(join(tmpdir(), 'experience-pipeline-'));
  directories.push(artifactDirectory);
  const key = new Uint8Array(32).fill(7);
  const buildDigest = 'a'.repeat(64);
  const manifest: ExperienceManifest = {
    format: 'baci.experience/v2' as const,
    runtime: 'react-browser-sandbox/v1' as const,
    sdkVersion: 'commerce-bridge/v1' as const,
    entry: 'Experience.tsx',
    files: [{ path: 'Experience.tsx', content: 'export default () => null' }],
    packages: [],
    routes:
      view === 'home'
        ? [{ path: '/', view: 'home' }]
        : [{ path: '/products/[handle]', view: 'product' }],
    assets: [],
    capabilities: [],
  };
  let currentBootstrap = {
    currency: 'NGN',
    assets: { product: 'http://127.0.0.1:4100/old-asset' },
    route: {
      epoch: 1,
      routeId: view,
      params: (view === 'home' ? {} : { handle: 'product-1' }) as Record<
        string,
        string
      >,
      canonicalPath,
      publicDataRevision: 'catalog-v1',
    },
    catalog: {
      revision: 'catalog-v1',
      products: [
        {
          id: 'product-1',
          slug: 'product-1',
          canonicalPath: '/phones/product-1',
          name: 'Product',
          price: 100,
          currency: 'NGN',
          image: { assetId: 'product', alt: 'Product' },
          variants: [],
        },
      ],
    },
    capabilities: [],
  };
  const digest = sourceDigest(manifest);
  const binding = {
    merchantId: 'merchant',
    buildId: 'build',
    buildDigest,
    sourceDigest: digest,
  };
  const report = {
    format: 'baci.performance-lab/v1' as const,
    buildDigest,
    sourceDigest: digest,
    measuredAt: '2026-10-26T12:00:00.000Z',
    renderer: 'prerender' as const,
    environment: 'local-synthetic' as const,
    cwvQualified: false as const,
    releaseQualified: false as const,
    contaminated: false,
    browser: '142.0.7444.0',
    bootstrapDigests: [
      {
        route: canonicalPath,
        digest: experienceBootstrapFingerprint(currentBootstrap),
      },
    ],
    samples: [390, 390, 390, 1440, 1440, 1440].map((width) => ({
      width: width as 390 | 1440,
      cache: 'cold-context' as const,
      route: canonicalPath,
      frameLcpMs: 1200,
      hostLcpMs: 1300,
      frameCls: 0.01,
      hostCls: 0.02,
      interactionDurationMs: null,
      contentVisible: true,
      imagesDecoded: true,
      consoleErrors: 0,
    })),
  };
  createLocalPerformanceReports(
    key,
    join(artifactDirectory, 'performance')
  ).retain(binding, report);

  const input = {
    ...settings(),
    artifactDirectory,
    build: { ...settings().build, key },
    bootstrap: vi.fn(async () => currentBootstrap),
  };
  const pipeline = createLocalPrerenderPipeline(input);
  const ctx = { merchantId: binding.merchantId } as never;
  const readCurrent = () =>
    pipeline.readPerformance(binding, { ctx, manifest });

  await expect(readCurrent()).resolves.toEqual(report);
  currentBootstrap = {
    ...currentBootstrap,
    assets: { product: 'http://127.0.0.1:4100/new-immutable-asset' },
    route: { ...currentBootstrap.route, epoch: 2 },
  };
  await expect(readCurrent()).resolves.toEqual(report);

  currentBootstrap = {
    ...currentBootstrap,
    catalog: {
      ...currentBootstrap.catalog,
      products: currentBootstrap.catalog.products.map((product) => ({
        ...product,
        price: 125,
      })),
    },
  };
  await expect(readCurrent()).resolves.toBeUndefined();
  expect(input.bootstrap).toHaveBeenCalledTimes(3);
});
it.each([
  'https://remote.example/qa1',
  'http://127.0.0.1:4102/qa1',
  'http://user:password@127.0.0.1:4100/qa1',
])('rejects an invalid pipeline presentation origin %s', (canonicalBase) => {
  expect(() =>
    createLocalPrerenderPipeline({ ...settings(), canonicalBase })
  ).toThrow();
});
it('cannot be enabled in a production process', () => {
  vi.stubEnv('NODE_ENV', 'production');
  expect(() => createLocalPrerenderPipeline(settings())).toThrow(
    'PROFILE_DISABLED'
  );
});

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
