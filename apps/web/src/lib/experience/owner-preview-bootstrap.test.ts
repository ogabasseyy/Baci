// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

const loadCatalog = vi.hoisted(() => vi.fn());
const authorize = vi.hoisted(() => vi.fn());
vi.mock('./catalog-adapter', () => ({ loadOwnerPreviewCatalog: loadCatalog }));
vi.mock('./authorization', () => ({ requireExperienceOwner: authorize }));

import { loadOwnerPreviewBootstrap } from './owner-preview-bootstrap';

const ctx = { merchantId: 'merchant-a', supabase: {} } as never;
const manifest = {
  routes: [
    { path: '/', view: 'home' },
    { path: '/collections/[handle]', view: 'collection' },
    { path: '/products/[handle]', view: 'product' },
    { path: '/pages/story', view: 'editorial' },
  ],
  capabilities: ['catalog.read'],
} as never;
const product = {
  id: 'p1',
  slug: 'phone',
  name: 'Synthetic phone',
  price: 250,
  currency: 'USD',
  canonicalPath: '/products/phone',
  image: null,
  variants: [],
  available: true,
  requiresVariant: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  authorize.mockResolvedValue(ctx);
  loadCatalog.mockResolvedValue({
    catalog: { products: [product], revision: 'rev1' },
    currency: 'USD',
  });
});
it('creates private previews from the authorized catalog and actual route', async () => {
  const home = await loadOwnerPreviewBootstrap(ctx, manifest, 'home');
  expect(home).toMatchObject({
    currency: 'USD',
    route: { routeId: 'home', canonicalPath: '/', publicDataRevision: 'rev1' },
    catalog: { products: [product] },
  });
  expect(
    (await loadOwnerPreviewBootstrap(ctx, manifest, 'collection')).route
  ).toMatchObject({
    canonicalPath: '/collections/all',
    params: { handle: 'all' },
  });
  expect(
    (await loadOwnerPreviewBootstrap(ctx, manifest, 'product')).route
  ).toMatchObject({
    canonicalPath: '/products/phone',
    params: { handle: 'phone' },
  });
  expect(
    (await loadOwnerPreviewBootstrap(ctx, manifest, '/pages/story')).route
      .canonicalPath
  ).toBe('/pages/story');
  expect(authorize).toHaveBeenCalledWith(ctx, 'storefront.read');
});
it('rejects missing routes and does not invent a product for an empty store', async () => {
  await expect(
    loadOwnerPreviewBootstrap(ctx, manifest, 'checkout')
  ).rejects.toThrow('NOT_FOUND');
  expect(loadCatalog).not.toHaveBeenCalled();
  loadCatalog.mockResolvedValue({
    catalog: { products: [], revision: 'rev2' },
    currency: 'EUR',
  });
  expect(
    (await loadOwnerPreviewBootstrap(ctx, manifest, 'home')).currency
  ).toBe('EUR');
  await expect(
    loadOwnerPreviewBootstrap(ctx, manifest, 'product')
  ).rejects.toThrow('NOT_FOUND');
});
it('does not return data when authorization is revoked after catalog read', async () => {
  authorize.mockRejectedValue(Error('NOT_FOUND'));
  await expect(
    loadOwnerPreviewBootstrap(ctx, manifest, 'home')
  ).rejects.toThrow('NOT_FOUND');
});
