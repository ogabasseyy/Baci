import { expect, it } from 'vitest';
import { resolveExperienceRoute } from './route-resolver';

const routes = [
  { path: '/', view: 'home' as const },
  { path: '/products/[handle]', view: 'product' as const },
  { path: '/collections/[handle]', view: 'collection' as const },
  { path: '/pages/story', view: 'editorial' as const },
];
it('uses existing category-aware canonical decision, alias redirect and missing products', async () => {
  const deps = {
    product: async (handle: string) =>
      handle === 'phone' ? { canonicalPath: '/phones/phone', id: 'p' } : null,
    collection: async () => null,
  };
  expect(
    await resolveExperienceRoute(routes, '/products/phone', deps)
  ).toMatchObject({ kind: 'redirect', location: '/phones/phone' });
  expect(
    await resolveExperienceRoute(routes, '/products/missing', deps)
  ).toEqual({ kind: 'not-found' });
  expect(
    await resolveExperienceRoute(routes, '/collections/missing', deps)
  ).toEqual({ kind: 'not-found' });
  expect(
    await resolveExperienceRoute(routes, '/pages/story', deps)
  ).toMatchObject({ kind: 'route', route: { view: 'editorial' } });
});
