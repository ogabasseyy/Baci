import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CategoryProductPage from './page';

vi.mock('server-only', () => ({}));

const { mockNormalizeStorefrontProductVariants } = vi.hoisted(() => ({
  mockNormalizeStorefrontProductVariants: vi.fn<
    (...args: unknown[]) => Record<string, unknown>[]
  >(() => []),
}));

const mockGetRequestScopedMerchant = vi.fn();
const mockGetCachedProductLcpHint = vi.fn();
const mockGetCachedProductWithDetails = vi.fn();

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers()),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
  permanentRedirect: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('next/server', () => ({
  connection: () => Promise.resolve(),
}));

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: (...args: unknown[]) =>
    mockGetRequestScopedMerchant(...args),
  getCachedProductLcpHint: (...args: unknown[]) =>
    mockGetCachedProductLcpHint(...args),
  getCachedProductWithDetails: (...args: unknown[]) =>
    mockGetCachedProductWithDetails(...args),
  getCachedLegacyProductRedirectTarget: vi.fn().mockResolvedValue(null),
  sanitizeLookupLogValue: (v: unknown) => String(v ?? ''),
}));

vi.mock('@/lib/storefront-product-variants', () => ({
  normalizeStorefrontProductVariants: (...args: unknown[]) =>
    mockNormalizeStorefrontProductVariants(...args),
}));

vi.mock(
  '@/components/storefront/ogabassey/pdp/critical-commerce.client',
  () => ({
    OgabasseyPdpCriticalCommerceProvider: ({
      children,
    }: {
      children: ReactNode;
    }) => children,
    OgabasseyPdpCriticalCommerceSummary: () => null,
  })
);

vi.mock('@/components/storefront/ogabassey/pdp/client-islands', () => ({
  OgabasseyPdpBelowFoldIsland: () => null,
  OgabasseyPdpDeferredDetailIsland: () => null,
}));

vi.mock('@/components/storefront/ogabassey/pdp/critical-commerce', () => ({
  OgabasseyPdpCriticalCommerce: () => null,
}));

vi.mock('@/components/storefront/ogabassey/pdp/critical-shell', () => ({
  OgabasseyPdpCriticalShell: ({ children }: { children: ReactNode }) =>
    children,
}));

vi.mock('@/components/storefront/ogabassey/pdp/server-primary-details', () => ({
  OgabasseyPdpServerPrimaryDetails: () => null,
}));

vi.mock(
  '@/components/storefront/ogabassey/pdp/generic-product-route-summary',
  () => ({
    GenericProductRouteSummary: () => null,
  })
);

vi.mock('@/components/seo/json-ld', () => ({
  JsonLd: () => null,
}));

vi.mock(
  '@/app/(storefront)/ogabassey/ogabassey-pdp-product-resource-hints',
  () => ({
    preloadOgabasseyPdpProductResources: vi.fn(),
  })
);

vi.mock('./ogabassey-pdp-request-scoped-semantic-sections', () => ({
  OgabasseyPdpRequestScopedSemanticSections: () => null,
}));

vi.mock(
  '@/components/storefront/ogabassey/seo/semantic-sections-error-boundary',
  () => ({
    SemanticSectionsErrorBoundary: ({ children }: { children: ReactNode }) =>
      children,
  })
);

const baseMerchant = {
  id: 'merchant-1',
  business_name: 'TestStore',
  slug: 'teststore',
  template_id: 'default',
  is_published: true,
  payout_currency: 'NGN',
  country: 'NG',
};

const categorizedDetailedProduct = {
  id: 'prod-1',
  merchant_id: 'merchant-1',
  name: 'HP Laptop 14-ep0063nia',
  slug: 'hp-laptop-14-ep0063nia',
  description: 'A laptop',
  status: 'active',
  price: 645600,
  compare_at_price: null,
  manage_stock: false,
  stock: 10,
  stock_quantity: 10,
  images: [],
  imageHint: null,
  brand: 'HP',
  category: 'Laptops',
  categories: {
    id: 'cat-1',
    name: 'Laptops',
    slug: 'laptops',
    parent_id: null,
  },
  product_variants: [] as unknown[],
  product_offers: [] as unknown[],
};

describe('[category]/[productSlug] page route-selection indexing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.head.innerHTML = '';
    mockGetRequestScopedMerchant.mockResolvedValue(baseMerchant);
  });

  it('renders <meta name="robots" content="noindex, follow"> when variant_id or offer_id is invalid/missing, and omits it when valid or absent', async () => {
    mockNormalizeStorefrontProductVariants.mockReturnValue([
      {
        id: 'variant-valid-1',
        attributes: { storage: '256GB' },
        condition: 'new',
        stock_quantity: 5,
      },
    ]);
    const mockProductData = {
      ...categorizedDetailedProduct,
      has_variants: true,
      product_offers: [
        {
          id: 'offer-valid-1',
          condition: 'used',
          price: 400000,
          status: 'active',
          stock_quantity: 2,
        },
      ],
      product_variants: [
        {
          id: 'variant-valid-1',
          attributes: { storage: '256GB' },
          condition: 'new',
          stock_quantity: 5,
        },
      ],
    };
    mockGetCachedProductLcpHint.mockResolvedValue(mockProductData);
    mockGetCachedProductWithDetails.mockResolvedValue(mockProductData);

    const renderPage = async (searchParams: Record<string, string>) =>
      render(
        (await CategoryProductPage({
          params: Promise.resolve({
            slug: 'teststore',
            category: 'laptops',
            productSlug: 'hp-laptop-14-ep0063nia',
          }),
          searchParams: Promise.resolve(searchParams),
        })) as React.ReactElement
      );

    const invalidVariantRender = await renderPage({
      variant_id: 'variant-gone',
    });
    expect(
      document.querySelectorAll(
        'meta[name="robots"][content="noindex, follow"]'
      )
    ).toHaveLength(1);
    invalidVariantRender.unmount();
    document.head.innerHTML = '';

    const invalidOfferRender = await renderPage({ offer_id: 'offer-gone' });
    expect(
      document.querySelectorAll(
        'meta[name="robots"][content="noindex, follow"]'
      )
    ).toHaveLength(1);
    invalidOfferRender.unmount();
    document.head.innerHTML = '';

    const validVariantRender = await renderPage({
      variant_id: 'variant-valid-1',
    });
    expect(
      document.querySelector('meta[name="robots"][content="noindex, follow"]')
    ).toBeNull();
    validVariantRender.unmount();
    document.head.innerHTML = '';

    const cleanRender = await renderPage({});
    expect(
      document.querySelector('meta[name="robots"][content="noindex, follow"]')
    ).toBeNull();
    cleanRender.unmount();
  });
});
