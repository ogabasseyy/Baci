import { expect, it, vi } from 'vitest';
import { derivePublicVerificationPlan } from './public-verification-plan';

const digest = 'a'.repeat(64);
const head = {
  merchantId: '10000000-0000-4000-8000-000000000001',
  buildDigest: digest,
  version: 1,
  policyRevision: '1',
  assetsDigest: 'b'.repeat(64),
  routes: [
    { path: '/', view: 'home' as const },
    { path: '/collections/[handle]', view: 'collection' as const },
    { path: '/products/[handle]', view: 'product' as const },
    { path: '/pages/story', view: 'editorial' as const },
  ],
  assets: [],
  capabilities: [],
};
const binding = {
  merchantId: head.merchantId,
  slug: 'synthetic',
  buildDigest: digest,
  publicationRevision: 1,
  canonicalBase: 'https://shop.example',
  scriptDigest: 'c'.repeat(64),
  styleDigest: 'd'.repeat(64),
  assets: {},
  head,
};
const product = {
  id: 'product-1',
  slug: 'device',
  name: 'Synthetic device',
  price: 250,
  currency: 'NGN',
  image: null,
  canonicalPath: '/smartphones/device',
  available: true,
  requiresVariant: true,
  variants: [{ id: 'variant-1', label: 'Blue', available: true }],
};
function fixture() {
  return {
    catalog: vi.fn(async () => ({ products: [product], revision: 'rev' })),
    resolveBoundary: vi.fn(
      async (_merchant: { id: string; slug: string }, path: string) => ({
        manifest: head,
        title: `Store · ${path}`,
        canonicalUrl: `https://shop.example${path}`,
        bootstrap: {
          route: {
            routeId:
              path === '/'
                ? 'home'
                : path.startsWith('/collections/')
                  ? 'collection'
                  : path.startsWith('/pages/')
                    ? 'editorial'
                    : 'product',
          },
        },
      })
    ),
  };
}
it('derives all declared route families and a purchasable product from the bound public runtime', async () => {
  const result = await derivePublicVerificationPlan(binding, fixture());
  expect(result.routes.map((route) => route.path)).toEqual([
    '/',
    '/collections/all',
    '/smartphones/device',
    '/pages/story',
  ]);
  expect(result.journeySteps.map((step) => step.action)).toEqual([
    'navigate',
    'product',
    'cart-add',
    'cart-read',
    'checkout-review',
  ]);
  expect(result.product).toEqual({
    id: 'product-1',
    slug: 'device',
    variantId: 'variant-1',
    path: '/smartphones/device',
  });
});
it('does not invent a product or accept a changed head or foreign canonical URL', async () => {
  const empty = fixture();
  empty.catalog.mockResolvedValueOnce({ products: [], revision: 'rev' });
  await expect(derivePublicVerificationPlan(binding, empty)).rejects.toThrow();
  const changed = fixture();
  changed.resolveBoundary.mockResolvedValueOnce({
    manifest: { ...head, version: 2 },
    title: 'Store',
    canonicalUrl: 'https://shop.example/',
    bootstrap: { route: { routeId: 'home' } },
  });
  await expect(
    derivePublicVerificationPlan(binding, changed)
  ).rejects.toThrow();
  const foreign = fixture();
  foreign.resolveBoundary.mockResolvedValueOnce({
    manifest: head,
    title: 'Store',
    canonicalUrl: 'https://other.example/',
    bootstrap: { route: { routeId: 'home' } },
  });
  await expect(
    derivePublicVerificationPlan(binding, foreign)
  ).rejects.toThrow();
  const wrongFamily = fixture();
  wrongFamily.resolveBoundary.mockResolvedValueOnce({
    manifest: head,
    title: 'Store',
    canonicalUrl: 'https://shop.example/',
    bootstrap: { route: { routeId: 'product' } },
  });
  await expect(
    derivePublicVerificationPlan(binding, wrongFamily)
  ).rejects.toThrow();
});
