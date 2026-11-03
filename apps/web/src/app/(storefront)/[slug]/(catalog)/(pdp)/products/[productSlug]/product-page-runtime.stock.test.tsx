import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCachedProductRatingStats,
  getCachedProductReviews,
  getPublicSupabaseClient,
  loadCategoryScopedSemanticInventorySafely,
  loadPublishedClusterPostsSafely,
  ProductSemanticSections,
} = vi.hoisted(() => ({
  getCachedProductRatingStats: vi.fn(),
  getCachedProductReviews: vi.fn(),
  getPublicSupabaseClient: vi.fn(),
  loadCategoryScopedSemanticInventorySafely: vi.fn(),
  loadPublishedClusterPostsSafely: vi.fn(),
  ProductSemanticSections: vi.fn(() => null),
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedProductRatingStats,
  getCachedProductReviews,
  getPublicSupabaseClient,
}));

vi.mock(
  '@/lib/storefront-product/load-category-scoped-semantic-inventory-safely',
  () => ({ loadCategoryScopedSemanticInventorySafely })
);

vi.mock('@/lib/storefront-content/load-published-cluster-posts-safely', () => ({
  loadPublishedClusterPostsSafely,
}));

vi.mock(
  '@/components/storefront/ogabassey/seo/product-semantic-sections',
  () => ({
    ProductSemanticSections,
  })
);

vi.mock(
  '@/lib/storefront-product/load-pdp-brand-hub-eligibility-inventory-safely',
  () => ({
    loadPdpBrandHubEligibilityInventorySafely: vi.fn().mockResolvedValue([]),
    PDP_BRAND_HUB_ELIGIBILITY_BELOW_FOLD_TIMEOUT_MS: 1_000,
  })
);

vi.mock('@/lib/seo-utils', () => ({
  buildStorefrontAcceptedPaymentMethods: () => [],
  generateAggregateRating: () => null,
  generateReviewListSchema: () => [],
  generateBreadcrumbSchema: vi.fn(() => ({ '@type': 'BreadcrumbList' })),
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

import { ProductPageBelowFold } from './product-page-runtime';

type ProductPageBelowFoldProduct = Parameters<
  typeof ProductPageBelowFold
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

describe('ProductPageBelowFold semantic model stock resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCachedProductRatingStats.mockResolvedValue({
      averageRating: 5,
      totalReviews: 2,
    });
    getCachedProductReviews.mockResolvedValue([]);
    loadCategoryScopedSemanticInventorySafely.mockResolvedValue({
      isCollection: false,
      categoryName: 'Smartphones',
      products: [],
    });
    loadPublishedClusterPostsSafely.mockResolvedValue([]);
  });

  it('resolves unmanaged product (manage_stock: false, stock: 0) as stock: null and renders checkout confirmation copy', async () => {
    const unmanagedProduct = {
      ...(product as ProductPageBelowFoldProduct),
      manage_stock: false,
      stock: 0,
      stock_quantity: 0,
    };

    const tree = (await ProductPageBelowFold({
      baseUrl: 'https://ogabassey.com',
      categoryName: 'Smartphones',
      categorySlug: 'smartphones',
      currency: 'NGN',
      merchant,
      product: unmanagedProduct,
      productUrl: 'https://ogabassey.com/products/anchor-flagship',
      slug: 'ogabassey',
    })) as ReactElement;

    const sections = directChildren(tree).find(
      (child) => child.type === ProductSemanticSections
    );
    expect(sections).toBeDefined();
    const model = (
      sections?.props as {
        model?: {
          contextParagraphs?: string[];
        };
      }
    ).model;

    expect(model?.contextParagraphs?.[0]).toContain(
      'Live stock, selected options and delivery timing should still be confirmed at checkout.'
    );
    expect(model?.contextParagraphs?.[0]).not.toContain('out of stock');
  });

  it('resolves tracked sold-out product (manage_stock: true, stock: 0) as stock: 0 and renders out-of-stock copy', async () => {
    const trackedSoldOutProduct = {
      ...(product as ProductPageBelowFoldProduct),
      manage_stock: true,
      stock: 0,
      stock_quantity: 0,
    };

    const tree = (await ProductPageBelowFold({
      baseUrl: 'https://ogabassey.com',
      categoryName: 'Smartphones',
      categorySlug: 'smartphones',
      currency: 'NGN',
      merchant,
      product: trackedSoldOutProduct,
      productUrl: 'https://ogabassey.com/products/anchor-flagship',
      slug: 'ogabassey',
    })) as ReactElement;

    const sections = directChildren(tree).find(
      (child) => child.type === ProductSemanticSections
    );
    expect(sections).toBeDefined();
    const model = (
      sections?.props as {
        model?: {
          contextParagraphs?: string[];
        };
      }
    ).model;

    expect(model?.contextParagraphs?.[0]).toContain(
      'Availability should be rechecked because this item may currently be out of stock.'
    );
    expect(model?.contextParagraphs?.[0]).not.toContain(
      'Live stock, selected options and delivery timing should still be confirmed at checkout.'
    );
  });

  it('resolves positive stock when base pool stock_quantity is positive even if legacy stock is zero', async () => {
    const productWithStockQuantity = {
      ...(product as ProductPageBelowFoldProduct),
      manage_stock: true,
      stock: 0,
      stock_quantity: 12,
    };

    const tree = (await ProductPageBelowFold({
      baseUrl: 'https://ogabassey.com',
      categoryName: 'Smartphones',
      categorySlug: 'smartphones',
      currency: 'NGN',
      merchant,
      product: productWithStockQuantity,
      productUrl: 'https://ogabassey.com/products/anchor-flagship',
      slug: 'ogabassey',
    })) as ReactElement;

    const sections = directChildren(tree).find(
      (child) => child.type === ProductSemanticSections
    );
    expect(sections).toBeDefined();
    const model = (
      sections?.props as {
        model?: {
          contextParagraphs?: string[];
        };
      }
    ).model;

    expect(model?.contextParagraphs?.[0]).not.toContain(
      'Availability should be rechecked because this item may currently be out of stock.'
    );
  });
});
