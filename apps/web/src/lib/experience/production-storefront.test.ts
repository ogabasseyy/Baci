// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  active: true,
  signals: [] as Array<AbortSignal | undefined>,
  revision: 'synthetic-1',
  head: {
    merchantId: 'synthetic-merchant',
    buildDigest: 'a'.repeat(64),
    hostOrigin: 'https://merchant.test',
    assets: [],
  },
  readRenderer: vi.fn(() => ({ javascript: 'synthetic renderer' })),
}));
vi.mock('../../../tools/experience-runner/durable-prerender-artifacts', () => ({
  createDurablePrerenderArtifacts: () => ({ read: f.readRenderer }),
}));
vi.mock('./public-output-reader', () => ({
  createPublicOutputReader: () => ({
    manifest: async (slug: string, signal?: AbortSignal) => {
      f.signals.push(signal);
      return f.active && slug === 'qa1' ? f.head : null;
    },
    prerenderBinding: async (
      _slug: string,
      _build: string,
      signal?: AbortSignal
    ) => {
      f.signals.push(signal);
      return f.active
        ? {
            merchantId: f.head.merchantId,
            buildId: 'synthetic-build',
            buildDigest: f.head.buildDigest,
            sourceDigest: 'b'.repeat(64),
          }
        : null;
    },
    read: async (
      _slug: string,
      _digest: string,
      path: string,
      signal?: AbortSignal
    ) => {
      f.signals.push(signal);
      return {
        path,
        mime: path === 'app.js' ? 'text/javascript' : 'text/css',
        bytes: Buffer.from(path === 'app.js' ? 'export{}' : ''),
        digest: 'c'.repeat(64),
      };
    },
  }),
}));
vi.mock('./public-runtime', () => ({
  createPublicExperienceRuntime: () => ({
    resolveBoundary: async (
      _identity: unknown,
      _path: string,
      signal?: AbortSignal
    ) => {
      f.signals.push(signal);
      return f.active
        ? {
            manifest: f.head,
            bootstrap: {
              route: {
                epoch: 1,
                routeId: 'home',
                canonicalPath: '/',
                params: {},
                publicDataRevision: f.revision,
              },
              catalog: { products: [], revision: f.revision },
              capabilities: [],
            },
          }
        : null;
    },
  }),
}));

import { createProductionStorefront } from './production-storefront';

beforeEach(() => {
  f.active = true;
  f.signals.length = 0;
  f.revision = 'synthetic-1';
  vi.clearAllMocks();
});
function fixture(
  canonicalBase: Parameters<
    typeof createProductionStorefront
  >[0]['canonicalBase'] = async (slug) => `https://merchant.test/${slug}`
) {
  const execute = vi.fn(
    async (
      _kind: Parameters<
        Parameters<typeof createProductionStorefront>[0]['execute']
      >[0],
      _payload: unknown,
      _signal?: AbortSignal
    ) => ({
      output: {
        format: 'baci-prerender/v1',
        html: '<main><h1>Synthetic Orbit</h1></main>',
      },
      jobId: 'synthetic',
      wallMs: 1,
    })
  );
  const storefront = createProductionStorefront({
    client: {} as never,
    artifactDirectory: '/unused-test-only',
    executionOrigin: 'https://output.baci-runtime.test',
    canonicalBase,
    execute,
  });
  const request = () =>
    new Request(
      `https://output.baci-runtime.test/published/qa1/${f.head.buildDigest}/index.html`
    );
  return { ...storefront, execute, request };
}
it('reuses only safe public fragments while refreshing bootstrap and checking RLS on every delivery', async () => {
  const s = fixture();
  expect((await s.deliver(s.request())).status).toBe(200);
  expect((await s.deliver(s.request())).status).toBe(200);
  expect(s.execute).toHaveBeenCalledOnce();
  f.revision = 'synthetic-2';
  expect((await s.deliver(s.request())).status).toBe(200);
  expect(s.execute).toHaveBeenCalledTimes(2);
  f.active = false;
  expect((await s.deliver(s.request())).status).toBe(404);
  expect(s.execute).toHaveBeenCalledTimes(2);
});
it('denies a render whose publication or catalog changes during isolated execution', async () => {
  const s = fixture();
  s.execute.mockImplementationOnce(async () => {
    f.active = false;
    return {
      output: { format: 'baci-prerender/v1', html: '<main>withdrawn</main>' },
      jobId: 'synthetic',
      wallMs: 1,
    };
  });
  expect((await s.deliver(s.request())).status).toBe(404);
});

it('cancels the canonical lookup when the delivery request disconnects', async () => {
  const controller = new AbortController();
  const canonicalBase = vi.fn(async (slug: string, _signal?: AbortSignal) => {
    controller.abort();
    return `https://merchant.test/${slug}`;
  });
  const s = fixture(canonicalBase);
  const request = new Request(s.request(), { signal: controller.signal });
  const response = await s.deliver(request);
  expect(canonicalBase.mock.calls[0]?.[1]?.aborted).toBe(true);
  expect(response.status).toBe(404);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(s.execute).not.toHaveBeenCalled();
});

it('aborts the runner for an uncached delivery when its last request disconnects', async () => {
  const s = fixture();
  const controller = new AbortController();
  const started = Promise.withResolvers<AbortSignal | undefined>();
  s.execute.mockImplementationOnce(async (_kind, _payload, signal) => {
    started.resolve(signal);
    await new Promise<never>((_, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      });
    });
    throw Error('UNREACHABLE');
  });
  const response = s.deliver(
    new Request(s.request(), { signal: controller.signal })
  );
  const signal = await started.promise;
  expect(signal?.aborted).toBe(false);
  controller.abort();
  expect((await response).status).toBe(404);
  expect(signal?.aborted).toBe(true);
});

it('ties every delivery database operation to the request lifetime', async () => {
  const s = fixture();
  const controller = new AbortController();
  const request = new Request(s.request(), { signal: controller.signal });
  expect((await s.deliver(request)).status).toBe(200);
  expect(f.signals.length).toBeGreaterThanOrEqual(8);
  expect(f.signals.every((signal) => signal?.aborted === false)).toBe(true);
  controller.abort();
  expect(f.signals.every((signal) => signal?.aborted === true)).toBe(true);
});
