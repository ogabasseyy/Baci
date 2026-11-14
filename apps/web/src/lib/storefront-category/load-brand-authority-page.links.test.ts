import { beforeEach, describe, expect, it, vi } from 'vitest';
import { brandAuthorityPageLoader } from './load-brand-authority-page';

const mockGetMerchant = vi.fn();
const mockGetCategory = vi.fn();
const mockGetCachedBrandAuthorityProducts = vi.fn();
const mockLoadPublishedClusterPostsSafely = vi.fn();
let mockHeaders = new Headers();

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(mockHeaders),
}));

vi.mock('./get-cached-brand-authority-products', () => ({
  getCachedBrandAuthorityProducts: (...args: unknown[]) =>
    mockGetCachedBrandAuthorityProducts(...args),
}));

vi.mock('@/lib/storefront-category/brand-authority-public-data', () => ({
  brandAuthorityPublicData: {
    getMerchant: (...args: unknown[]) => mockGetMerchant(...args),
    getCategory: (...args: unknown[]) => mockGetCategory(...args),
  },
}));

vi.mock('@/lib/normalize-product', async () => ({
  isRawDbProductRecord: (await import('@/lib/raw-db-product'))
    .isRawDbProductRecord,
  normalizeProduct: (product: unknown) => product,
}));

vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: () => 'https://ogabassey.com',
}));

vi.mock('@/lib/storefront-content/load-published-cluster-posts-safely', () => ({
  loadPublishedClusterPostsSafely: (...args: unknown[]) =>
    mockLoadPublishedClusterPostsSafely(...args),
}));

function makeProduct(index: number, brand = 'Samsung') {
  return {
    id: `product-${index}`,
    name: `${brand} Phone ${index}`,
    slug: `${brand.toLowerCase()}-phone-${index}`,
    category: 'Smartphones',
    category_slug: 'smartphones',
    brand,
    price: 100_000 + index,
    condition: 'new',
    stock: 2,
    manage_stock: true,
    availability: 'InStock' as const,
    has_condition_offers: false,
    product_key_specs: null,
    image: 'https://cdn.example.com/phone.jpg',
    description: 'Phone description',
  };
}

describe('loadBrandAuthorityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders = new Headers();
    mockGetMerchant.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'Ogabassey',
      country: 'NG',
      payout_currency: 'NGN',
    });
    mockGetCategory.mockResolvedValue({
      id: 'category-1',
      name: 'Smartphones',
    });
    mockGetCachedBrandAuthorityProducts.mockResolvedValue(
      Array.from({ length: 6 }, (_, index) => makeProduct(index))
    );
    mockLoadPublishedClusterPostsSafely.mockResolvedValue([]);
  });

  it('resolves correct category nouns and handles fallbacks', async () => {
    const { getCategoryAuthorityNoun } = await import(
      './get-category-authority-noun'
    );
    expect(getCategoryAuthorityNoun('smartphones', 'Smartphones')).toEqual({
      titleNoun: 'Phones',
      lowerNoun: 'phones',
    });
    expect(getCategoryAuthorityNoun('laptops', 'Laptops')).toEqual({
      titleNoun: 'Laptops',
      lowerNoun: 'laptops',
    });
    expect(getCategoryAuthorityNoun('tablets', 'Tablets')).toEqual({
      titleNoun: 'Tablets',
      lowerNoun: 'tablets',
    });
    expect(getCategoryAuthorityNoun('smartwatches')).toEqual({
      titleNoun: 'Smartwatches',
      lowerNoun: 'smartwatches',
    });
    expect(getCategoryAuthorityNoun('accessories', 'Accessories')).toEqual({
      titleNoun: 'Accessories',
      lowerNoun: 'accessories',
    });
  });

  it('renders PlayStation 5 brand authority page without repeating brand name', async () => {
    mockGetCategory.mockResolvedValueOnce({
      id: 'cat-ps5',
      name: 'PlayStation 5',
    });
    mockGetCachedBrandAuthorityProducts.mockResolvedValueOnce(
      Array.from({ length: 6 }, (_, index) => ({
        ...makeProduct(index, 'PlayStation'),
        category: 'PlayStation 5',
        category_slug: 'playstation-5',
      }))
    );

    const page = await brandAuthorityPageLoader.load(
      {
        merchantSlug: 'ogabassey',
        categorySlug: 'playstation-5',
        brandSlug: 'playstation',
      },
      { includeRequestPathPrefix: false }
    );

    expect(page).toMatchObject({
      heading: 'PlayStation 5 Games, Consoles and Prices in Nigeria',
      metaDescription:
        'Compare a selection of 6 PlayStation 5 products from Ogabassey, with current prices, key specs, condition, and availability in Nigeria.',
      intro:
        'Explore a selection of 6 PlayStation 5 products from Ogabassey. Compare current prices, specifications, condition, and availability before choosing a model.',
    });
    expect(page?.heading).not.toContain('PlayStation PlayStation 5');
  });

  it('renders audio category brand authority page with Audio & Speakers heading', async () => {
    mockGetCategory.mockResolvedValueOnce({
      id: 'cat-audio',
      name: 'Audio',
    });
    mockGetCachedBrandAuthorityProducts.mockResolvedValueOnce(
      Array.from({ length: 6 }, (_, index) => ({
        ...makeProduct(index, 'JBL'),
        category: 'Audio',
        category_slug: 'audio',
      }))
    );

    const page = await brandAuthorityPageLoader.load(
      {
        merchantSlug: 'ogabassey',
        categorySlug: 'audio',
        brandSlug: 'jbl',
      },
      { includeRequestPathPrefix: false }
    );

    expect(page).toMatchObject({
      heading: 'JBL Audio & Speakers and Prices in Nigeria',
      metaDescription:
        'Compare a selection of 6 JBL audio products from Ogabassey, with current prices, key specs, condition, and availability in Nigeria.',
    });
  });
});
