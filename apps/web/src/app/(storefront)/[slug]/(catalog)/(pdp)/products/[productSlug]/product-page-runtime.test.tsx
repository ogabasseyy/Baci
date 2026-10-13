import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
  Suspense,
} from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Track the optional/deferred data reads so we can prove the critical shell
// never awaits them. Hoisted so the vi.mock factories (which are hoisted above
// module-level consts) can reference the same stubs.
const {
  getCachedProductRatingStats,
  getCachedProductReviews,
  getPublicSupabaseClient,
  loadCategoryScopedSemanticInventorySafely,
  loadPublishedClusterPostsSafely,
  generateBreadcrumbSchema,
  JsonLd,
  ProductDetailClient,
  ProductSemanticSections,
} = vi.hoisted(() => {
  // A promise that never settles: if the critical shell awaited any of these
  // deferred reads, the render in the test below would hang instead of
  // resolving.
  const neverSettles = () =>
    new Promise(() => {
      // Intentionally never resolves.
    });
  return {
    getCachedProductRatingStats: vi.fn(neverSettles),
    getCachedProductReviews: vi.fn(neverSettles),
    getPublicSupabaseClient: vi.fn(neverSettles),
    loadCategoryScopedSemanticInventorySafely: vi.fn(neverSettles),
    loadPublishedClusterPostsSafely: vi.fn(neverSettles),
    generateBreadcrumbSchema: vi.fn(() => ({ '@type': 'BreadcrumbList' })),
    JsonLd: vi.fn(() => null),
    ProductDetailClient: vi.fn(() => null),
    ProductSemanticSections: vi.fn(() => null),
  };
});

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedProductRatingStats,
  getCachedProductReviews,
  // PdpRepairDeviceLink (deferred below the fold) reads through this client;
  // the critical shell must never touch it.
  getPublicSupabaseClient,
}));

vi.mock(
  '@/lib/storefront-product/load-category-scoped-semantic-inventory-safely',
  () => ({ loadCategoryScopedSemanticInventorySafely })
);

vi.mock('@/lib/storefront-content/load-published-cluster-posts-safely', () => ({
  loadPublishedClusterPostsSafely,
}));

// Identifiable leaf stubs (hoisted above) so we can locate the critical-shell
// nodes in the tree without pulling in the real client bundle.
vi.mock('@/components/seo/json-ld', () => ({ JsonLd }));
vi.mock('./product-detail-client', () => ({ default: ProductDetailClient }));
vi.mock(
  '@/components/storefront/ogabassey/seo/product-semantic-sections',
  () => ({
    ProductSemanticSections,
  })
);

// Pure orchestration helpers stubbed so the test asserts the streaming boundary,
// not schema content (covered by their own suites).
vi.mock('@/lib/seo-utils', () => ({
  buildStorefrontAcceptedPaymentMethods: () => [],
  generateBreadcrumbSchema,
  generateFAQSchema: () => ({ '@type': 'FAQPage' }),
  generateProductSchema: () => ({
    '@type': 'Product',
    offers: { '@type': 'Offer', price: 500_000, availability: 'InStock' },
  }),
  generateSlug: (value: string) => value,
  getValidatedProductUrl: () =>
    'https://ogabassey.com/products/anchor-flagship',
}));

vi.mock('@/lib/store-url', () => ({
  buildRequestScopedStoreUrl: () => 'https://ogabassey.com',
}));

vi.mock('@/lib/storefront-trust/build-merchant-trust-profile', () => ({
  buildMerchantTrustProfile: () => ({}),
}));

vi.mock('@/lib/resolve-merchant-currency', () => ({
  resolveMerchantCurrencyConfig: () => ({ code: 'NGN' }),
}));

vi.mock('@/lib/korapay', () => ({ isKorapayConfigured: () => true }));
vi.mock('@/lib/paystack', () => ({ isPaystackConfigured: () => true }));

import { ProductPageRuntime } from './product-page-runtime';

type ProductPageRuntimeProduct = Parameters<
  typeof ProductPageRuntime
>[0]['product'];

const merchant = {
  id: 'merchant-1',
  slug: 'ogabassey',
  business_name: 'Ogabassey',
  country: 'NG',
  logo_url: null,
} as never;

const product = {
  id: 'product-1',
  slug: 'anchor-flagship',
  name: 'Anchor Flagship',
  brand: 'Apple',
  condition: 'new',
  price: 500_000,
  stock: 5,
  category: 'Smartphones',
  category_slug: 'smartphones',
  categories: { name: 'Smartphones' },
  product_key_specs: {},
} as never;

function directChildren(tree: ReactElement): ReactElement[] {
  const children = (tree.props as { children?: ReactNode }).children;
  return Children.toArray(children).filter((child): child is ReactElement =>
    isValidElement(child)
  );
}

describe('ProductPageRuntime critical shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the core product and offers JSON-LD without awaiting reviews, inventory, guides or repairs', async () => {
    // The optional reads are stubbed to never resolve. If the critical shell
    // awaited any of them, this render would hang instead of resolving.
    const tree = (await ProductPageRuntime({
      merchant,
      product,
      slug: 'ogabassey',
    })) as ReactElement;

    // Proof the critical path does not fetch the deferred data.
    expect(getCachedProductRatingStats).not.toHaveBeenCalled();
    expect(getCachedProductReviews).not.toHaveBeenCalled();
    expect(loadCategoryScopedSemanticInventorySafely).not.toHaveBeenCalled();
    expect(loadPublishedClusterPostsSafely).not.toHaveBeenCalled();
    expect(getPublicSupabaseClient).not.toHaveBeenCalled();

    const children = directChildren(tree);

    // The offers/price/availability + breadcrumb JSON-LD and the LCP-bearing
    // product client render in the critical shell (direct children).
    const jsonLdNodes = children.filter((child) => child.type === JsonLd);
    expect(jsonLdNodes.length).toBeGreaterThanOrEqual(2);
    const productJsonLd = jsonLdNodes.find(
      (node) => (node.props as { data?: { offers?: unknown } }).data?.offers
    );
    expect(productJsonLd).toBeDefined();
    expect(children.some((child) => child.type === ProductDetailClient)).toBe(
      true
    );

    // The optional enrichment (semantic sections + review structured data) is
    // NOT a direct child — it is deferred behind a Suspense boundary.
    expect(
      children.some((child) => child.type === ProductSemanticSections)
    ).toBe(false);
    const suspense = children.find((child) => child.type === Suspense);
    expect(suspense).toBeDefined();
    expect((suspense?.props as { fallback?: unknown }).fallback ?? null).toBe(
      null
    );
    // The deferred child is an async server component (rendered lazily by the
    // boundary), never invoked during the critical render above.
    const deferredChild = (suspense?.props as { children?: ReactElement })
      .children;
    expect(typeof deferredChild?.type).toBe('function');
  });

  it('uses a slug-only camera join before stale phone text for PDP and crawl context', async () => {
    const tree = (await ProductPageRuntime({
      merchant,
      product: {
        // The shared fixture is deliberately cast for the runtime's full
        // product contract; recover that contract before extending it.
        ...(product as ProductPageRuntimeProduct),
        category: 'Smartphones',
        category_slug: 'smartphones',
        categories: { slug: 'action-cameras' },
      },
      slug: 'ogabassey',
    })) as ReactElement;

    expect(generateBreadcrumbSchema).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'action-cameras',
          url: 'https://ogabassey.com/action-cameras',
        }),
      ])
    );

    const suspense = directChildren(tree).find(
      (child) => child.type === Suspense
    );
    const deferredChild = (suspense?.props as { children?: ReactElement })
      .children;
    expect(deferredChild?.props).toMatchObject({
      categoryName: 'action-cameras',
      categorySlug: 'action-cameras',
    });
  });

  it('ignores whitespace-only joined category slugs before falling back to canonical metadata', async () => {
    const tree = (await ProductPageRuntime({
      merchant,
      product: {
        ...(product as ProductPageRuntimeProduct),
        category: 'Smartphones',
        category_slug: 'action-cameras',
        categories: { name: 'Action Cameras', slug: '   ' },
      },
      slug: 'ogabassey',
    })) as ReactElement;

    expect(generateBreadcrumbSchema).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Action Cameras',
          url: 'https://ogabassey.com/action-cameras',
        }),
      ])
    );

    const suspense = directChildren(tree).find(
      (child) => child.type === Suspense
    );
    const deferredChild = (suspense?.props as { children?: ReactElement })
      .children;
    expect(deferredChild?.props).toMatchObject({
      categoryName: 'Action Cameras',
      categorySlug: 'action-cameras',
    });
  });

  it('uses /products for an uncategorized product instead of inventing /all-products', async () => {
    const tree = (await ProductPageRuntime({
      merchant,
      product: {
        ...(product as ProductPageRuntimeProduct),
        category: undefined,
        category_slug: undefined,
        categories: null,
      },
      slug: 'ogabassey',
    })) as ReactElement;

    expect(generateBreadcrumbSchema).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'All Products',
          url: 'https://ogabassey.com/products',
        }),
      ])
    );

    const suspense = directChildren(tree).find(
      (child) => child.type === Suspense
    );
    const deferredChild = (suspense?.props as { children?: ReactElement })
      .children;
    expect(deferredChild?.props).toMatchObject({ categorySlug: 'products' });
  });
});
