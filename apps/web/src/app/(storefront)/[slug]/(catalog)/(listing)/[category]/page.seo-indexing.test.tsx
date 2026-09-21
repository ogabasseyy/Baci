import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetCachedMerchant = vi.fn();
const mockGetCachedCategoryPageData = vi.fn();
const mockGetCachedCategoryPageGraphicsOptions = vi.fn();

vi.mock('@/lib/cached-data', () => ({
  getCachedMerchant: (...args: unknown[]) => mockGetCachedMerchant(...args),
  getCachedMerchantByDomain: (...args: unknown[]) =>
    mockGetCachedMerchant(...args),
  getCachedCategoryPageData: (...args: unknown[]) =>
    mockGetCachedCategoryPageData(...args),
  getCachedCategoryPageGraphicsOptions: (...args: unknown[]) =>
    mockGetCachedCategoryPageGraphicsOptions(...args),
}));
vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: () => 'https://zorvexa.usebaci.com',
}));
vi.mock('@/lib/storefront-slug-safety', () => ({
  evaluateStorefrontSlugSafety: () => ({ safe: true }),
}));
vi.mock('@/lib/validation', () => ({ isDomainIdentifier: () => false }));

const { generateMetadata } = await import('./page');

const merchant = {
  id: 'merchant-1',
  business_name: 'Zorvexa',
  country: 'NG',
  is_published: true,
  logo_url: null,
};

function expectedRobots(index: boolean) {
  return {
    index,
    follow: true,
    googleBot: {
      index,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
    'max-image-preview': 'large',
    'max-snippet': -1,
    'max-video-preview': -1,
  };
}

describe('category metadata SEO indexing', () => {
  beforeEach(() => {
    mockGetCachedMerchant.mockResolvedValue(merchant);
    mockGetCachedCategoryPageGraphicsOptions.mockResolvedValue([]);
  });

  it('emits noindex robots when the category product query fails', async () => {
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      category: null,
      products: [],
      productSlots: [],
      fallbackName: 'Fashion',
      fallbackDescription: '',
      isInactiveCategory: false,
      productsQueryFailed: true,
      productIdsQueryFailed: true,
      categoryQueryFailed: false,
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'zorvexa', category: 'fashion' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(metadata.robots).toEqual(expectedRobots(false));
  });

  it('emits noindex robots for a successful but empty category', async () => {
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      category: { id: 'category-1', name: 'Fashion', slug: 'fashion' },
      products: [],
      productSlots: [],
      productCount: 0,
      fallbackName: 'Fashion',
      fallbackDescription: '',
      isInactiveCategory: false,
      productsQueryFailed: false,
      productIdsQueryFailed: false,
      categoryQueryFailed: false,
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'zorvexa', category: 'fashion' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(metadata.robots).toEqual(expectedRobots(false));
  });

  it('preserves inherited Googlebot and preview directives for an indexable category', async () => {
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      category: { id: 'category-1', name: 'Fashion', slug: 'fashion' },
      products: [],
      productSlots: [],
      productCount: 1,
      fallbackName: 'Fashion',
      fallbackDescription: '',
      isInactiveCategory: false,
      productsQueryFailed: false,
      productIdsQueryFailed: false,
      categoryQueryFailed: false,
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'zorvexa', category: 'fashion' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(metadata.robots).toEqual(expectedRobots(true));
  });

  it('keeps inherited Googlebot and preview directives when existing filters block indexing', async () => {
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      category: { id: 'category-1', name: 'Fashion', slug: 'fashion' },
      products: [],
      productSlots: [],
      productCount: 1,
      fallbackName: 'Fashion',
      fallbackDescription: '',
      isInactiveCategory: false,
      productsQueryFailed: false,
      productIdsQueryFailed: false,
      categoryQueryFailed: false,
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'zorvexa', category: 'fashion' }),
      searchParams: Promise.resolve({ brand: 'zorvexa', color: 'blue' }),
    });

    expect(metadata.robots).toEqual(expectedRobots(false));
  });
});
