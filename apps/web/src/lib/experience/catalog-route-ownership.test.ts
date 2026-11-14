import { expect, it } from 'vitest';
import { resolveCatalogExperienceRoute } from './catalog-route-ownership';

it('requires product ownership as well as catalog membership for categorized routes', () => {
  const products = [{ slug: 'device', canonicalPath: '/phones/device' }];
  expect(
    resolveCatalogExperienceRoute(
      [{ path: '/', view: 'home' }],
      '/phones/device',
      products
    )
  ).toBeNull();
  expect(
    resolveCatalogExperienceRoute(
      [{ path: '/products/[handle]', view: 'product' }],
      '/phones/device',
      products
    )
  ).toMatchObject({ view: 'product', params: { handle: 'device' } });
  expect(
    resolveCatalogExperienceRoute(
      [{ path: '/products/[handle]', view: 'product' }],
      '/auth/device',
      [{ slug: 'device', canonicalPath: '/auth/device' }]
    )
  ).toBeNull();
});
