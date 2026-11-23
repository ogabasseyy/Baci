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

it('keeps the catalog order when choosing the first available variant', async () => {
  const deps = fixture();
  deps.catalog.mockResolvedValueOnce({
    products: [
      {
        ...product,
        variants: [
          { id: 'unavailable', label: 'Grey', available: false },
          { id: 'variant-z', label: 'Blue', available: true },
          { id: 'variant-a', label: 'Green', available: true },
        ],
      },
    ],
    revision: 'rev',
  });
  const result = await derivePublicVerificationPlan(binding, deps);
  expect(result.product.variantId).toBe('variant-z');
});

it.each([
  '/',
  '/pages/story',
])('plans partial coverage for %s and a native PDP', async (path) => {
  const route = head.routes.find((item) => item.path === path);
  if (!route) throw Error('FIXTURE_ROUTE_MISSING');
  const partial = { ...head, routes: [route] };
  const deps = fixture();
  deps.resolveBoundary.mockResolvedValueOnce({
    manifest: partial,
    title: 'Synthetic page',
    canonicalUrl: `https://shop.example${path}`,
    bootstrap: { route: { routeId: route.view } },
  });
  const plan = await derivePublicVerificationPlan(
    { ...binding, head: partial },
    deps
  );
  expect(plan.routes.map((item) => item.path)).toEqual([path]);
  expect(plan.product).toMatchObject({
    native: true,
    path: product.canonicalPath,
  });
  expect(plan.journeySteps[0]).toEqual({ action: 'navigate', path });
  expect(deps.resolveBoundary).toHaveBeenCalledTimes(1);
});

it('finds a purchasable product past a full page of unavailable products', async () => {
  const deps = fixture();
  const unavailable = Array.from({ length: 100 }, (_, index) => ({
    ...product,
    id: `unavailable-${index}`,
    requiresVariant: true,
    variants: product.variants.map((variant) => ({
      ...variant,
      available: false,
    })),
  }));
  deps.catalog
    .mockResolvedValueOnce({ products: unavailable, revision: 'first' })
    .mockResolvedValueOnce({ products: [product], revision: 'second' });
  const signal = new AbortController().signal;
  const result = await derivePublicVerificationPlan(binding, deps, signal);
  expect(result.product).toMatchObject({
    id: product.id,
    variantId: 'variant-1',
  });
  expect(deps.catalog).toHaveBeenNthCalledWith(
    1,
    { id: head.merchantId, slug: binding.slug },
    { offset: 0 },
    signal
  );
  expect(deps.catalog).toHaveBeenNthCalledWith(
    2,
    { id: head.merchantId, slug: binding.slug },
    { offset: 100 },
    signal
  );
  expect(deps.catalog).toHaveBeenCalledTimes(2);
});
