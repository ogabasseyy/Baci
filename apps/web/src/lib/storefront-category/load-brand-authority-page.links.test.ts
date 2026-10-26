import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/lib/normalize-product', () => ({
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
});
