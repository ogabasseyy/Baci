import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateMetadata } from './page';

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
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  permanentRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
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
    OgabasseyPdpCriticalCommerceProvider: () => null,
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
  OgabasseyPdpCriticalShell: () => null,
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
    SemanticSectionsErrorBoundary: () => null,
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

const categorizedProduct = {
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
    mockGetRequestScopedMerchant.mockResolvedValue(baseMerchant);
  });

  const getMetaRobots = async (searchParams: Record<string, string>) => {
    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'teststore',
        category: 'laptops',
        productSlug: 'hp-laptop-14-ep0063nia',
      }),
      searchParams: Promise.resolve(searchParams),
    });
    return metadata.robots;
  };

  it('keeps index: true for a valid variant_id on a published product', async () => {
    mockGetCachedProductLcpHint.mockResolvedValue({
      ...categorizedProduct,
      has_variants: true,
      product_variants: [{ id: 'variant-valid-1' }],
    });
    mockNormalizeStorefrontProductVariants.mockReturnValue([
      {
        id: 'variant-valid-1',
        attributes: { storage: '256GB' },
        condition: 'new',
        stock_quantity: 5,
      },
    ]);

    const robots = await getMetaRobots({ variant_id: 'variant-valid-1' });
    expect(robots).toMatchObject({
      index: true,
      follow: true,
      googleBot: expect.objectContaining({ index: true, follow: true }),
    });
  });

  it('preserves index: false for a valid variant_id on a draft/unpublished product', async () => {
    mockGetCachedProductLcpHint.mockResolvedValue({
      ...categorizedProduct,
      status: 'draft',
      has_variants: true,
      product_variants: [{ id: 'variant-valid-1' }],
    });
    mockNormalizeStorefrontProductVariants.mockReturnValue([
      {
        id: 'variant-valid-1',
        attributes: { storage: '256GB' },
        condition: 'new',
        stock_quantity: 5,
      },
    ]);

    const robots = await getMetaRobots({ variant_id: 'variant-valid-1' });
    expect(robots).toMatchObject({
      index: false,
      follow: true,
      googleBot: expect.objectContaining({ index: false, follow: true }),
    });
  });

  it('returns index: false, follow: true for an unknown variant_id on a product with variants', async () => {
    mockGetCachedProductLcpHint.mockResolvedValue({
      ...categorizedProduct,
      has_variants: true,
      product_variants: [{ id: 'variant-valid-1' }],
    });
    mockNormalizeStorefrontProductVariants.mockReturnValue([
      {
        id: 'variant-valid-1',
        attributes: { storage: '256GB' },
        condition: 'new',
        stock_quantity: 5,
      },
    ]);

    const robots = await getMetaRobots({ variant_id: 'variant-gone' });
    expect(robots).toMatchObject({
      index: false,
      follow: true,
      googleBot: expect.objectContaining({ index: false, follow: true }),
    });
  });

  it('returns index: false, follow: true when variant_id is supplied on a variantless product', async () => {
    mockGetCachedProductLcpHint.mockResolvedValue(categorizedProduct);
    mockNormalizeStorefrontProductVariants.mockReturnValue([]);

    const robots = await getMetaRobots({ variant_id: 'stale-variant-id' });
    expect(robots).toMatchObject({
      index: false,
      follow: true,
      googleBot: expect.objectContaining({ index: false, follow: true }),
    });
  });

  it('returns index: false, follow: true for an unknown offer_id', async () => {
    mockGetCachedProductLcpHint.mockResolvedValue({
      ...categorizedProduct,
      product_offers: [
        {
          id: 'offer-active-1',
          condition: 'used',
          price: 450000,
          stock_quantity: 2,
          status: 'active',
        },
      ],
    });

    const robots = await getMetaRobots({ offer_id: 'offer-gone' });
    expect(robots).toMatchObject({
      index: false,
      follow: true,
      googleBot: expect.objectContaining({ index: false, follow: true }),
    });
  });
});
