// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  active: true,
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
    manifest: async (slug: string) =>
      f.active && slug === 'qa1' ? f.head : null,
    prerenderBinding: async () =>
      f.active
        ? {
            merchantId: f.head.merchantId,
            buildId: 'synthetic-build',
            buildDigest: f.head.buildDigest,
            sourceDigest: 'b'.repeat(64),
          }
        : null,
    read: async (_slug: string, _digest: string, path: string) => ({
      path,
      mime: path === 'app.js' ? 'text/javascript' : 'text/css',
      bytes: Buffer.from(path === 'app.js' ? 'export{}' : ''),
      digest: 'c'.repeat(64),
    }),
  }),
}));
vi.mock('./public-runtime', () => ({
  createPublicExperienceRuntime: () => ({
    resolveBoundary: async () =>
      f.active
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
        : null,
  }),
}));

import { createProductionStorefront } from './production-storefront';

beforeEach(() => {
  f.active = true;
  f.revision = 'synthetic-1';
  vi.clearAllMocks();
});
function fixture() {
  const execute = vi.fn(async () => ({
    output: {
      format: 'baci-prerender/v1',
      html: '<main><h1>Synthetic Orbit</h1></main>',
    },
    jobId: 'synthetic',
    wallMs: 1,
  }));
  const storefront = createProductionStorefront({
    client: {} as never,
    artifactDirectory: '/unused-test-only',
    executionOrigin: 'https://output.baci-runtime.test',
    canonicalBase: (slug) => `https://merchant.test/${slug}`,
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
