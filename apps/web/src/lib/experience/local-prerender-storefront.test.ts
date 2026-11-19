import { expect, it, vi } from 'vitest';
import { startLocalPrerenderStorefront } from './local-prerender-storefront';

const fixture = vi.hoisted(() => {
  const digest = 'a'.repeat(64);
  const manifest = { buildDigest: digest, assets: [] };
  const bootstrap = {
    route: {
      epoch: 1,
      routeId: 'home',
      params: {},
      canonicalPath: '/',
      publicDataRevision: 'revision-1',
    },
    catalog: { products: [], revision: 'catalog-1' },
    capabilities: [],
  };
  const binding = {
    merchantId: 'merchant',
    buildId: 'build',
    buildDigest: digest,
  };
  const renderState = {
    resolveBoundary: vi.fn(async () => ({ manifest, bootstrap })),
  };
  const renderRefs: Array<(input: never) => Promise<string>> = [];
  const execute = vi.fn(async () => ({
    jobId: 'render-job',
    output: { format: 'baci-prerender/v1', html: '<main>Published</main>' },
  }));
  const artifacts = { read: vi.fn(() => ({ javascript: 'export{}' })) };
  return { digest, binding, renderState, renderRefs, execute, artifacts };
});

vi.mock('../../../tools/experience-runner/durable-prerender-artifacts', () => ({
  createDurablePrerenderArtifacts: () => fixture.artifacts,
}));
vi.mock('./public-output-reader', () => ({
  createPublicOutputReader: () => ({
    prerenderBinding: vi.fn(async () => fixture.binding),
  }),
}));
vi.mock('./public-runtime', () => ({
  createPublicExperienceRuntime: () => fixture.renderState,
}));
vi.mock('../../../tools/experience-runner/published-gateway', () => ({
  startPublishedGateway: vi.fn(async (_reader, _hostOrigin, _port, options) => {
    fixture.renderRefs.push(options.render);
    return { origin: 'http://127.0.0.1:4101', close: vi.fn() };
  }),
}));

it('caches validated fragments while binding each response to its current public bootstrap', async () => {
  const appJs = { path: 'app.js', url: '', digest: 'b'.repeat(64) };
  const appCss = { path: 'app.css', url: '', digest: 'c'.repeat(64) };
  appJs.url = `http://127.0.0.1:4101/published/shop/${fixture.digest}/app.js`;
  appCss.url = `http://127.0.0.1:4101/published/shop/${fixture.digest}/app.css`;
  const storefront = await startLocalPrerenderStorefront({
    client: {} as never,
    artifactDirectory: '/tmp/experience-prerender-test',
    hostOrigin: 'http://127.0.0.1:4100',
    canonicalBase: () => 'http://127.0.0.1:4100/shop',
    execute: fixture.execute as never,
  });
  const render = fixture.renderRefs.at(-1);
  expect(render).toBeDefined();
  const input = {
    slug: 'shop',
    merchantId: 'merchant',
    buildDigest: fixture.digest,
    path: '/',
    resources: [appJs, appCss],
  } as never;
  const first = await render?.(input);
  const second = await render?.(input);

  expect(first).toContain('<main>Published</main>');
  expect(second).toContain('<main>Published</main>');
  expect(fixture.execute).toHaveBeenCalledTimes(1);
  expect(fixture.artifacts.read).toHaveBeenCalledWith(fixture.binding);
  expect(fixture.renderState.resolveBoundary).toHaveBeenCalledTimes(4);
  await storefront.gateway.close();
});
