import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateMetadata } from './page';

const { mockConnection, mockNormalizeStorefrontProductVariants } = vi.hoisted(
  () => ({
    mockConnection: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    mockNormalizeStorefrontProductVariants: vi.fn<
      (...args: unknown[]) => Record<string, unknown>[]
    >(() => []),
  })
);

const mockHeaders = vi.fn();
const mockGetRequestScopedMerchant = vi.fn();
const mockGetCachedProductWithDetails = vi.fn();

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
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
  connection: () => mockConnection(),
}));

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: (...args: unknown[]) =>
    mockGetRequestScopedMerchant(...args),
  getCachedLegacyProductRedirectTarget: vi.fn().mockResolvedValue(null),
  getCachedProductWithDetails: (...args: unknown[]) =>
    mockGetCachedProductWithDetails(...args),
  sanitizeLookupLogValue: (v: unknown) => String(v ?? ''),
}));

vi.mock('@/lib/storefront-product-variants', () => ({
  normalizeStorefrontProductVariants: (...args: unknown[]) =>
    mockNormalizeStorefrontProductVariants(...args),
}));

const stubParent = Promise.resolve({}) as never;

const baseMerchant = {
  id: 'merchant-1',
  business_name: 'TestStore',
  slug: 'teststore',
  logo_url: null,
  payout_currency: 'NGN',
  country: 'NG',
  is_published: true,
};

const uncategorizedProduct = {
  id: 'prod-2',
  merchant_id: 'merchant-1',
  name: 'Mystery Item',
  slug: 'mystery-item',
  description: 'A phone',
  status: 'active',
  price: 500000,
  compare_at_price: null,
  manage_stock: false,
  stock: 10,
  stock_quantity: 10,
  images: [],
  category: undefined,
  categories: null,
  product_variants: [],
};

describe('products/[productSlug] page route-selection indexing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders.mockResolvedValue(new Headers());
    mockNormalizeStorefrontProductVariants.mockReturnValue([]);
    mockGetRequestScopedMerchant.mockResolvedValue(baseMerchant);
  });

  const getMetaRobots = async (searchParams: Record<string, string>) => {
    const metadata = await generateMetadata(
      {
        params: Promise.resolve({
          slug: 'teststore',
          productSlug: 'mystery-item',
        }),
        searchParams: Promise.resolve(searchParams),
      },
      stubParent
    );
    return metadata.robots;
  };

  it('keeps index: true for a valid variant_id on a published product', async () => {
    mockGetCachedProductWithDetails.mockResolvedValue(uncategorizedProduct);
    mockNormalizeStorefrontProductVariants.mockReturnValue([
      {
        id: 'variant-valid-1',
        attributes: { storage: '128GB' },
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
    mockGetCachedProductWithDetails.mockResolvedValue({
      ...uncategorizedProduct,
      status: 'draft',
    });
    mockNormalizeStorefrontProductVariants.mockReturnValue([
      {
        id: 'variant-valid-1',
        attributes: { storage: '128GB' },
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
    mockGetCachedProductWithDetails.mockResolvedValue(uncategorizedProduct);
    mockNormalizeStorefrontProductVariants.mockReturnValue([
      {
        id: 'variant-valid-1',
        attributes: { storage: '128GB' },
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
    mockGetCachedProductWithDetails.mockResolvedValue(uncategorizedProduct);
    mockNormalizeStorefrontProductVariants.mockReturnValue([]);

    const robots = await getMetaRobots({ variant_id: 'stale-variant-id' });
    expect(robots).toMatchObject({
      index: false,
      follow: true,
      googleBot: expect.objectContaining({ index: false, follow: true }),
    });
  });

  it('returns index: false, follow: true for an unknown offer_id', async () => {
    mockGetCachedProductWithDetails.mockResolvedValue({
      ...uncategorizedProduct,
      offers: [
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
