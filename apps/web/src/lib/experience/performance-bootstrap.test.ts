import { expect, it } from 'vitest';
import { validatePerformanceBootstrap } from './performance-bootstrap';

it('rejects a canonical route whose catalog identity points elsewhere', async () => {
  const manifest = {
    routes: [{ path: '/products/[handle]', view: 'product' }],
  } as never;
  const bootstrap = {
    route: {
      epoch: 1,
      routeId: 'product',
      canonicalPath: '/phones/device',
      params: { handle: 'device' },
      publicDataRevision: 'r',
    },
    catalog: {
      revision: 'r',
      products: [
        {
          id: 'p',
          slug: 'device',
          canonicalPath: '/laptops/device',
          name: 'Device',
          price: 1,
          currency: 'NGN',
          variants: [],
          image: null,
        },
      ],
    },
    capabilities: [],
  };
  await expect(
    validatePerformanceBootstrap(bootstrap, manifest, 'product')
  ).rejects.toThrow('INVALID_ROUTE');
  bootstrap.catalog.products[0].canonicalPath = '/phones/device';
  expect(
    (await validatePerformanceBootstrap(bootstrap, manifest, 'product')).route
      .canonicalPath
  ).toBe('/phones/device');
});
