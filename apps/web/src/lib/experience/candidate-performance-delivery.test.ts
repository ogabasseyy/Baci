import { expect, it, vi } from 'vitest';
import {
  candidate,
  makeInput,
  output,
  routeBootstrap,
} from './candidate-performance-fixture.test-support';
import { measureCandidatePerformance } from './candidate-performance-measurement';
import { digestBytes } from './manifest-digest';

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
