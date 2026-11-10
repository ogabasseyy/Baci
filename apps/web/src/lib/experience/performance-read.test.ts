import { expect, it, vi } from 'vitest';
import type { OwnerRequestContext } from './authorization';
import { readExperiencePerformance } from './performance-read';

const authorize = vi.hoisted(() =>
  vi.fn(async (ctx: unknown, _scope?: string) => ctx)
);
vi.mock('./authorization', () => ({ requireExperienceOwner: authorize }));

const manifest = {
  format: 'baci.experience/v2',
  runtime: 'react-browser-sandbox/v1',
  sdkVersion: 'commerce-bridge/v1',
  entry: 'Experience.tsx',
  files: [{ path: 'Experience.tsx', content: 'export default () => null' }],
  packages: [],
  routes: [
    { path: '/', view: 'home' },
    { path: '/pages/story', view: 'editorial' },
  ],
  assets: [],
  capabilities: [],
};

function context(
  options: { missing?: boolean; noArtifact?: boolean; product?: boolean } = {}
) {
  const tables = new Map<string, string[]>();
  const results = [
    {
      data: options.missing
        ? null
        : { build_digest: 'a'.repeat(64), job_id: 'job' },
      error: null,
    },
    {
      data: {
        source_digest: 'b'.repeat(64),
        artifact_id: 'artifact',
      },
      error: null,
    },
    {
      data: options.noArtifact
        ? null
        : {
            manifest: options.product
              ? {
                  ...manifest,
                  routes: [
                    { path: '/', view: 'home' },
                    { path: '/products/[handle]', view: 'product' },
                  ],
                }
              : manifest,
          },
      error: null,
    },
  ];
  const query = {
    select: vi.fn((columns: string) => {
      const table = currentTable;
      tables.set(table, [...(tables.get(table) ?? []), columns]);
      return query;
    }),
    eq: vi.fn((_column: string, _value: unknown) => query),
    maybeSingle: vi.fn(async () => results.shift()),
  };
  let currentTable = '';
  const ctx = {
    merchantId: 'merchant',
    supabase: {
      from: vi.fn((table: string) => {
        currentTable = table;
        return query;
      }),
    },
  } as unknown as OwnerRequestContext;
  return { ctx, query, tables };
}

function report(options: { contaminated?: boolean; partial?: boolean } = {}) {
  const routes = ['/', '/pages/story'];
  const samples = options.partial
    ? [
        {
          width: 390,
          cache: 'cold-context',
          route: '/',
          frameLcpMs: 100,
          hostLcpMs: null,
          frameCls: 0,
          hostCls: 0,
          interactionDurationMs: null,
          contentVisible: true,
          imagesDecoded: true,
          consoleErrors: 0,
        },
      ]
    : routes.flatMap((route) =>
        [390, 1440].flatMap((width) =>
          Array.from({ length: 3 }, () => ({
            width,
            cache: 'cold-context',
            route,
            frameLcpMs: 1200,
            hostLcpMs: 1300,
            frameCls: 0.01,
            hostCls: 0.02,
            interactionDurationMs: null,
            contentVisible: true,
            imagesDecoded: true,
            consoleErrors: 0,
          }))
        )
      );
  return {
    format: 'baci.performance-lab/v1',
    buildDigest: 'a'.repeat(64),
    sourceDigest: 'b'.repeat(64),
    measuredAt: '2026-10-25T18:00:00.000Z',
    renderer: 'prerender',
    environment: 'local-synthetic',
    cwvQualified: false,
    releaseQualified: false,
    contaminated: options.contaminated ?? false,
    browser: '142.0.7444.0',
    bootstrapDigests: routes.map((route) => ({
      route,
      digest: 'c'.repeat(64),
    })),
    samples,
  };
}

it('reads owner-scoped exact-build evidence and validates every declared route family', async () => {
  authorize.mockClear();
  const { ctx, query, tables } = context();
  const read = vi.fn(async (_binding: unknown) => report());

  expect(await readExperiencePerformance(ctx, 'build', read)).toMatchObject({
    status: 'lab-only',
    report: { contaminated: false, cwvQualified: false },
    qualification: {
      status: 'passed',
      policyId: 'chromium-native-reference/v1',
      routeCount: 2,
      sampleCount: 12,
      cwvQualified: false,
      releaseQualified: false,
    },
  });
  expect(read).toHaveBeenCalledWith(
    {
      merchantId: 'merchant',
      buildId: 'build',
      buildDigest: 'a'.repeat(64),
      sourceDigest: 'b'.repeat(64),
    },
    { ctx, manifest }
  );
  expect([...tables.entries()]).toEqual([
    ['experience_builds', ['build_digest,job_id']],
    ['experience_jobs', ['source_digest,artifact_id']],
    ['experience_artifacts', ['manifest']],
  ]);
  expect(
    query.eq.mock.calls.filter(([column]) => column === 'merchant_id')
  ).toHaveLength(3);
  expect(authorize.mock.calls.map(([, scope]) => scope)).toEqual([
    'storefront.read',
    'storefront.read',
    'storefront.read',
  ]);
});

it('does not consult report or artifact readers for an invisible build', async () => {
  const { ctx } = context({ missing: true });
  const read = vi.fn(async (_binding: unknown) => report());

  await expect(
    readExperiencePerformance(ctx, 'other-build', read)
  ).rejects.toThrow('NOT_FOUND');
  expect(read).not.toHaveBeenCalled();
});

it('reports missing evidence without inventing a qualification result', async () => {
  const { ctx } = context();

  expect(await readExperiencePerformance(ctx, 'build')).toMatchObject({
    status: 'not-measured',
    cwvQualified: false,
    releaseQualified: false,
    qualification: {
      status: 'not-measured',
      cwvQualified: false,
      releaseQualified: false,
    },
  });
});

it('keeps contaminated and partial legacy reports readable but unqualified', async () => {
  const contaminated = await readExperiencePerformance(
    context().ctx,
    'build',
    async () => report({ contaminated: true })
  );
  expect(contaminated).toMatchObject({
    status: 'lab-only',
    qualification: { status: 'failed', reason: 'contaminated' },
  });

  const partial = await readExperiencePerformance(
    context().ctx,
    'build',
    async () => report({ partial: true })
  );
  expect(partial).toMatchObject({
    status: 'lab-only',
    qualification: { status: 'failed', reason: 'route-matrix-mismatch' },
  });

  const legacy: Record<string, unknown> = { ...report() };
  delete legacy.bootstrapDigests;
  expect(
    await readExperiencePerformance(context().ctx, 'build', async () => legacy)
  ).toMatchObject({
    status: 'lab-only',
    qualification: { status: 'failed', reason: 'data-binding-mismatch' },
  });
});

it.each([
  'buildDigest',
  'sourceDigest',
  'cwvQualified',
  'releaseQualified',
])('rejects mismatched or elevated %s', async (key) => {
  await expect(
    readExperiencePerformance(context().ctx, 'build', async () => ({
      ...report(),
      [key]: key.endsWith('Digest') ? 'c'.repeat(64) : true,
    }))
  ).rejects.toThrow('STALE_SOURCE');
});

it('rechecks the exact requested owner scope after reading retained data', async () => {
  const { ctx } = context();
  authorize.mockClear();

  await readExperiencePerformance(
    ctx,
    'build',
    async () => report(),
    'storefront.publish'
  );

  expect(authorize.mock.calls.map(([, scope]) => scope)).toEqual([
    'storefront.publish',
    'storefront.publish',
    'storefront.publish',
  ]);
});

it('denies owner revocation that happens while current public data is fingerprinted', async () => {
  const { ctx } = context();
  authorize.mockClear();
  authorize.mockImplementationOnce(async (value) => value);
  authorize.mockImplementationOnce(async (value) => value);
  authorize.mockImplementationOnce(async () => {
    throw Error('NOT_FOUND');
  });
  const read = vi.fn(async (_binding: unknown) => report());
  await expect(readExperiencePerformance(ctx, 'build', read)).rejects.toThrow(
    'NOT_FOUND'
  );
  expect(read).toHaveBeenCalledOnce();
});

it('fails closed when the owner-scoped source artifact is missing', async () => {
  await expect(
    readExperiencePerformance(
      context({ noArtifact: true }).ctx,
      'build',
      async () => report()
    )
  ).rejects.toThrow('NOT_FOUND');
});

it('retains the route matrix for trusted categorized PDP samples', async () => {
  const { ctx } = context({ product: true });
  const raw = report();
  for (const sample of raw.samples)
    if (sample.route === '/pages/story') sample.route = '/phones/device';
  raw.bootstrapDigests[1].route = '/phones/device';
  expect(
    (await readExperiencePerformance(ctx, 'build', async () => raw))
      .qualification.status
  ).toBe('passed');
});
