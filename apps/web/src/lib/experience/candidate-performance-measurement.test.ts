import { type ExperienceManifest, sourceDigest } from '@baci/shared/experience';
import { expect, it, vi } from 'vitest';
import { measureCandidatePerformance } from './candidate-performance-measurement';
import { digestBytes } from './manifest-digest';

const manifest: ExperienceManifest = {
  format: 'baci.experience/v2',
  runtime: 'react-browser-sandbox/v1',
  sdkVersion: 'commerce-bridge/v1',
  entry: 'Experience.tsx',
  files: [{ path: 'Experience.tsx', content: 'export default () => null' }],
  packages: [],
  routes: [
    { path: '/', view: 'home' },
    { path: '/products/[handle]', view: 'product' },
  ],
  assets: [],
  capabilities: [],
};
const candidate = {
  hostOrigin: 'http://127.0.0.1:4100',
  javascript: 'export default 1;',
  css: '',
  imports: [],
  digest: digestBytes('candidate'),
};
const routeBootstrap = (view: 'home' | 'product') => ({
  route: {
    epoch: 1,
    routeId: view,
    canonicalPath: view === 'home' ? '/' : '/products/sample-item',
    params: view === 'home' ? {} : { handle: 'sample-item' },
    publicDataRevision: 'revision',
  },
  catalog: {
    products:
      view === 'product'
        ? [
            {
              id: 'product-id',
              slug: 'sample-item',
              name: 'Sample item',
              price: 1,
              currency: 'NGN',
              image: null,
              variants: [],
              canonicalPath: '/products/sample-item',
            },
          ]
        : [],
    revision: 'revision',
  },
  capabilities: [],
});
const output = (input: unknown, extra: Record<string, unknown> = {}) => {
  const request = input as {
    width: 390 | 1440;
    bundle: { digest: string };
    bootstrap: { route: { canonicalPath: string } };
  };
  return {
    format: 'baci.performance-sample/v1',
    policyId: 'chromium-native-reference/v1',
    browser: 'Chromium 140',
    route: request.bootstrap.route.canonicalPath,
    width: request.width,
    buildDigest: request.bundle.digest,
    cache: 'cold-context',
    hostLcpMs: 900,
    frameLcpMs: 850,
    hostCls: 0,
    frameCls: 0,
    diagnostics: {
      host: {
        rawCls: 0.04,
        firstPaintMs: 123,
        rawLayoutShifts: [
          { startTime: 100, value: 0.04, hadRecentInput: false },
        ],
        layoutShiftOverflow: false,
      },
      frame: {
        rawCls: 0.08,
        firstPaintMs: 125,
        rawLayoutShifts: [
          { startTime: 101, value: 0.08, hadRecentInput: false },
        ],
        layoutShiftOverflow: false,
      },
    },
    interactionDurationMs: null,
    contentVisible: true,
    imagesDecoded: true,
    consoleErrors: 0,
    contaminated: false,
    observationWindowMs: 2000,
    ...extra,
  };
};
const makeInput = (execute: ReturnType<typeof vi.fn>) => ({
  execute,
  manifest,
  bootstrap: vi.fn(async (view: 'home' | 'product') => routeBootstrap(view)),
  candidate,
  renderer: candidate,
  rendererKind: 'client' as 'client' | 'prerender',
  assets: [] as Array<{
    assetId: string;
    digest: string;
    mime: 'image/png' | 'font/woff2';
    bytesBase64: string;
  }>,
  sourceDigest: sourceDigest(manifest),
  hostContaminated: () => false,
});

it('measures each declared route family at both widths for three cold samples', async () => {
  const execute = vi.fn(async (kind: string, input: unknown) => ({
    jobId: `job-${kind}`,
    output: output(input),
  }));
  const result = await measureCandidatePerformance(makeInput(execute) as never);
  expect(result.status).toBe('measured');
  expect(result.report?.samples).toHaveLength(12);
  expect(result.report?.samples[0]?.diagnostics?.frame.rawCls).toBe(0.08);
  expect(
    execute.mock.calls.filter(([kind]) => kind === 'performance')
  ).toHaveLength(12);
  expect(result.qualification).toMatchObject({
    routeCount: 2,
    sampleCount: 12,
  });
  expect(result.report?.cwvQualified).toBe(false);
  expect(result.report?.releaseQualified).toBe(false);
});

it('retains a contaminated worker sample as failed diagnostic evidence and stops early', async () => {
  const execute = vi.fn(async (kind: string, input: unknown) => ({
    jobId: `job-${kind}`,
    output: output(input, { contaminated: true }),
  }));
  const result = await measureCandidatePerformance(makeInput(execute) as never);
  expect(result.status).toBe('failed');
  expect(result.report?.contaminated).toBe(true);
  expect(result.report?.samples).toHaveLength(1);
  expect(execute).toHaveBeenCalledTimes(1);
});

it('returns not-measured for malformed or wrongly bound worker output', async () => {
  const execute = vi.fn(async (kind: string, input: unknown) => ({
    jobId: `job-${kind}`,
    output: output(input, { buildDigest: 'f'.repeat(64) }),
  }));
  const result = await measureCandidatePerformance(makeInput(execute) as never);
  expect(result).toEqual({
    status: 'not-measured',
    report: undefined,
    qualification: undefined,
    jobIds: ['job-performance'],
  });
});

it('does not start a browser when the local host CPU is contaminated', async () => {
  const execute = vi.fn();
  const input = makeInput(execute);
  input.hostContaminated = () => true;
  const result = await measureCandidatePerformance(input as never);
  expect(result.status).toBe('not-measured');
  expect(execute).not.toHaveBeenCalled();
});

it('does not invent a product route when its public bootstrap omits that product', async () => {
  const execute = vi.fn(async (kind: string, input: unknown) => ({
    jobId: `job-${kind}`,
    output: output(input),
  }));
  const input = makeInput(execute);
  input.bootstrap.mockImplementation(async (view) => ({
    ...routeBootstrap(view),
    ...(view === 'product'
      ? { catalog: { products: [], revision: 'revision' } }
      : {}),
  }));
  const result = await measureCandidatePerformance(input as never);
  expect(result.status).toBe('not-measured');
  expect(
    execute.mock.calls.filter(([kind]) => kind === 'performance')
  ).toHaveLength(6);
});

it('enforces the SSR HTML byte budget on every representative route', async () => {
  const execute = vi.fn(async (kind: string, payload: unknown) => ({
    jobId: `job-${kind}`,
    output:
      kind === 'prerender'
        ? {
            format: 'baci-prerender/v1',
            html:
              (payload as { bootstrap: { route: { canonicalPath: string } } })
                .bootstrap.route.canonicalPath === '/'
                ? '<main>home</main>'
                : 'x'.repeat(128 * 1024 + 1),
          }
        : output(payload),
  }));
  const input = makeInput(execute);
  input.rendererKind = 'prerender';
  await expect(
    measureCandidatePerformance(input as never)
  ).rejects.toMatchObject({
    code: 'PERFORMANCE_BUDGET_EXCEEDED',
    resource: 'ssr-html',
  });
  expect(
    execute.mock.calls.filter(([kind]) => kind === 'prerender')
  ).toHaveLength(2);
  expect(
    execute.mock.calls.filter(([kind]) => kind === 'performance')
  ).toHaveLength(6);
});

it('propagates owner authorization failures from route bootstrap', async () => {
  const input = makeInput(vi.fn());
  input.bootstrap.mockRejectedValueOnce(Error('NOT_FOUND'));
  await expect(measureCandidatePerformance(input as never)).rejects.toThrow(
    'NOT_FOUND'
  );
});

it('reports not-measured when a new store has no representative product', async () => {
  const input = makeInput(vi.fn());
  input.bootstrap.mockRejectedValueOnce(Error('NO_REPRESENTATIVE_PRODUCT'));
  await expect(
    measureCandidatePerformance(input as never)
  ).resolves.toMatchObject({
    status: 'not-measured',
    report: undefined,
  });
});

it('supplies complete rewritten prerender HTML and verified asset bytes to the worker', async () => {
  const assetBytes = Buffer.from('local image bytes');
  const assetUrl = `http://127.0.0.1:4101/resource/${candidate.digest}/assets/hero-image`;
  const input = makeInput(
    vi.fn(async (kind: string, payload: unknown) => ({
      jobId: `job-${kind}`,
      output:
        kind === 'prerender'
          ? {
              format: 'baci-prerender/v1',
              html: `<main><h1>Store</h1><img src="${(payload as { bootstrap: { assets?: Record<string, string> } }).bootstrap.assets?.['hero-image']}"></main>`,
            }
          : output(payload),
    }))
  );
  input.rendererKind = 'prerender';
  input.assets = [
    {
      assetId: 'hero-image',
      digest: digestBytes(assetBytes),
      mime: 'image/png',
      bytesBase64: assetBytes.toString('base64'),
    },
  ];
  input.bootstrap.mockImplementation(async (view) => ({
    ...routeBootstrap(view),
    assets: { 'hero-image': 'http://public.invalid/original-image.png' },
  }));
  const result = await measureCandidatePerformance(input as never);
  const prerender = input.execute.mock.calls.find(
    ([kind]) => kind === 'prerender'
  );
  const measured = input.execute.mock.calls.find(
    ([kind]) => kind === 'performance'
  );
  expect(result.status).toBe('measured');
  expect(prerender?.[1]).toMatchObject({
    bootstrap: { assets: { 'hero-image': assetUrl } },
  });
  expect(measured?.[1]).toMatchObject({
    html: expect.stringContaining('data-baci-experience-build'),
    assets: [expect.objectContaining({ assetId: 'hero-image' })],
    bootstrap: { route: { canonicalPath: '/' } },
  });
  expect((measured?.[1] as { html: string }).html).toContain(assetUrl);
});

it('refuses HTTPS qualification from an HTTP-only worker', async () => {
  const execute = vi.fn(async (_kind: string, input: unknown) => ({
    jobId: 'http-worker',
    output: output(input),
  }));
  const request = makeInput(execute);
  request.candidate = {
    ...candidate,
    hostOrigin: 'https://merchant.synthetic.test',
  };
  const result = await measureCandidatePerformance(request as never);
  expect(result.status).toBe('not-measured');
  expect(result.report).toBeUndefined();
});

it('measures real-TLS diagnostics at both widths without granting field qualification', async () => {
  const execute = vi.fn(async (_kind: string, input: unknown) => {
    const sample = output(input);
    return {
      jobId: 'tls-worker',
      output: {
        ...sample,
        diagnostics: {
          ...sample.diagnostics,
          transport: 'https-loopback-tls',
          tlsConnections: 2,
        },
      },
    };
  });
  const request = makeInput(execute);
  request.candidate = {
    ...candidate,
    hostOrigin: 'https://merchant.synthetic.test',
  };
  const result = await measureCandidatePerformance(request as never);
  expect(result.status).toBe('measured');
  expect(result.report?.samples).toHaveLength(12);
  expect(result.report?.cwvQualified).toBe(false);
  expect(result.report?.releaseQualified).toBe(false);
});

it('binds prerender HTTPS resources and rewritten CSS integrity to the same delivery bytes', async () => {
  const execute = vi.fn(async (kind: string, input: unknown) => {
    if (kind === 'prerender')
      return {
        jobId: 'render',
        output: {
          format: 'baci-prerender/v1',
          html: '<main><h1>Synthetic store</h1></main>',
        },
      };
    const sample = output(input);
    return {
      jobId: 'tls',
      output: {
        ...sample,
        diagnostics: {
          ...sample.diagnostics,
          transport: 'https-loopback-tls',
          tlsConnections: 2,
        },
      },
    };
  });
  const request = makeInput(execute);
  request.rendererKind = 'prerender';
  request.candidate = {
    ...candidate,
    hostOrigin: 'https://merchant.synthetic.test',
    css: 'body{background:url(/assets/image)}',
  };
  const bytes = Buffer.from('synthetic');
  request.assets = [
    {
      assetId: 'image',
      mime: 'image/png',
      bytesBase64: bytes.toString('base64'),
      digest: digestBytes(bytes),
    },
  ];
  const result = await measureCandidatePerformance(request as never);
  expect(result.status).toBe('measured');
  const performance = execute.mock.calls.find(
    ([kind]) => kind === 'performance'
  )?.[1] as { html: string };
  expect(performance.html).toContain(
    'https://artifacts.baci-cwv.invalid/resource/'
  );
  expect(performance.html).not.toContain('http://127.0.0.1:4101');
  const css = `body{background:url(https://artifacts.baci-cwv.invalid/resource/${candidate.digest}/assets/image)}`;
  expect(performance.html).toContain(
    `sha256-${Buffer.from(digestBytes(css), 'hex').toString('base64')}`
  );
});

it('measures a canonical categorized PDP while rejecting its noncanonical alias', async () => {
  const execute = vi.fn(async (_kind: string, payload: unknown) => ({
    jobId: 'synthetic',
    output: output(payload),
  }));
  const input = makeInput(execute);
  input.bootstrap.mockImplementation(async (view) => {
    const bootstrap = routeBootstrap(view);
    if (view === 'product') {
      bootstrap.route.canonicalPath = '/phones/sample-item';
      bootstrap.catalog.products[0].canonicalPath = '/phones/sample-item';
    }
    return bootstrap;
  });
  expect((await measureCandidatePerformance(input as never)).status).toBe(
    'measured'
  );
  input.bootstrap.mockImplementation(async (view) => {
    const bootstrap = routeBootstrap(view);
    if (view === 'product')
      bootstrap.catalog.products[0].canonicalPath = '/phones/sample-item';
    return bootstrap;
  });
  expect((await measureCandidatePerformance(input as never)).status).toBe(
    'not-measured'
  );
});
