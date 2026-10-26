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

  it('rejects missing merchants and unsafe route slugs before catalog reads', async () => {
    const { brandAuthorityPageLoader } = await import(
      './load-brand-authority-page'
    );
    mockGetMerchant.mockResolvedValueOnce(null);

    await expect(
      brandAuthorityPageLoader.load({
        merchantSlug: 'missing',
        categorySlug: 'smartphones',
        brandSlug: 'samsung',
      })
    ).resolves.toBeNull();
    await expect(
      brandAuthorityPageLoader.load({
        merchantSlug: 'ogabassey',
        categorySlug: '',
        brandSlug: 'samsung',
      })
    ).resolves.toBeNull();
    await expect(
      brandAuthorityPageLoader.load({
        merchantSlug: 'ogabassey',
        categorySlug: 'smartphones',
        brandSlug: '',
      })
    ).resolves.toBeNull();

    expect(mockGetCategory).not.toHaveBeenCalled();
  });

  it('rejects a category that is not publicly available', async () => {
    mockGetCategory.mockResolvedValue(null);
    const { brandAuthorityPageLoader } = await import(
      './load-brand-authority-page'
    );

    await expect(
      brandAuthorityPageLoader.load({
        merchantSlug: 'ogabassey',
        categorySlug: 'smartphones',
        brandSlug: 'samsung',
      })
    ).resolves.toBeNull();
    expect(mockGetCachedBrandAuthorityProducts).not.toHaveBeenCalled();
  });

  it('resolves path prefixes for platform and custom-domain requests', async () => {
    const { brandAuthorityPageLoader } = await import(
      './load-brand-authority-page'
    );

    await expect(
      brandAuthorityPageLoader.getStorefrontPathPrefix('ogabassey', 'ogabassey')
    ).resolves.toBe('/ogabassey');

    mockHeaders = new Headers({ 'x-custom-domain': 'ogabassey.com' });
    await expect(
      brandAuthorityPageLoader.getStorefrontPathPrefix('ogabassey', 'ogabassey')
    ).resolves.toBe('');

    mockHeaders = new Headers({ 'x-merchant-slug': 'ogabassey' });
    await expect(
      brandAuthorityPageLoader.getStorefrontPathPrefix('ogabassey', 'ogabassey')
    ).resolves.toBe('');

    mockHeaders = new Headers();
    await expect(
      brandAuthorityPageLoader.getStorefrontPathPrefix(
        'ogabassey.com',
        'ogabassey'
      )
    ).resolves.toBe('');
  });

  it('renders category-aware nouns and custom intro for laptops', async () => {
    mockGetCategory.mockResolvedValueOnce({
      id: 'category-laptops',
      name: 'Laptops',
    });
    mockGetCachedBrandAuthorityProducts.mockResolvedValueOnce([
      {
        id: 'laptop-1',
        name: 'MacBook Air 13 M2',
        slug: 'macbook-air-13-m2',
        category: 'Laptops',
        category_slug: 'laptops',
        brand: 'Apple',
        price: 900_000,
        condition: 'new',
        stock: 3,
        availability: 'InStock' as const,
        has_condition_offers: false,
        product_key_specs: null,
        image: 'https://cdn.example.com/air.jpg',
        description: 'MacBook Air',
      },
      {
        id: 'laptop-2',
        name: 'MacBook Air 15 M3',
        slug: 'macbook-air-15-m3',
        category: 'Laptops',
        category_slug: 'laptops',
        brand: 'Apple',
        price: 1_200_000,
        condition: 'new',
        stock: 2,
        availability: 'InStock' as const,
        has_condition_offers: false,
        product_key_specs: null,
        image: 'https://cdn.example.com/air15.jpg',
        description: 'MacBook Air 15',
      },
      {
        id: 'laptop-3',
        name: 'MacBook Air M1',
        slug: 'macbook-air-m1',
        category: 'Laptops',
        category_slug: 'laptops',
        brand: 'Apple',
        price: 700_000,
        condition: 'refurbished',
        stock: 1,
        availability: 'InStock' as const,
        has_condition_offers: false,
        product_key_specs: null,
        image: 'https://cdn.example.com/airm1.jpg',
        description: 'MacBook Air M1',
      },
      {
        id: 'laptop-4',
        name: 'MacBook Pro 14 M3 Pro',
        slug: 'macbook-pro-14-m3-pro',
        category: 'Laptops',
        category_slug: 'laptops',
        brand: 'Apple',
        price: 2_000_000,
        condition: 'new',
        stock: 4,
        availability: 'InStock' as const,
        has_condition_offers: false,
        product_key_specs: null,
        image: 'https://cdn.example.com/pro14.jpg',
        description: 'MacBook Pro 14',
      },
      {
        id: 'laptop-5',
        name: 'MacBook Pro 16 M3 Max',
        slug: 'macbook-pro-16-m3-max',
        category: 'Laptops',
        category_slug: 'laptops',
        brand: 'MacBook',
        price: 3_000_000,
        condition: 'new',
        stock: 2,
        availability: 'InStock' as const,
        has_condition_offers: false,
        product_key_specs: null,
        image: 'https://cdn.example.com/pro16.jpg',
        description: 'MacBook Pro 16',
      },
    ]);

    const { brandAuthorityPageLoader } = await import(
      './load-brand-authority-page'
    );
    const page = await brandAuthorityPageLoader.load(
      {
        merchantSlug: 'ogabassey',
        categorySlug: 'laptops',
        brandSlug: 'apple',
      },
      { includeRequestPathPrefix: false }
    );

    expect(page).toMatchObject({
      canonicalUrl: 'https://ogabassey.com/laptops/brands/apple',
      heading: 'Apple MacBook Laptops and Prices in Nigeria',
      categoryName: 'Laptops',
      intro:
        'Compare Apple MacBook Air and MacBook Pro laptops at Ogabassey across M-series and Intel configurations.',
      metaDescription:
        'Compare a selection of 5 Apple MacBook laptops from Ogabassey, with current prices, key specs, condition, and availability in Nigeria.',
    });
    expect(page?.familyLinks).toContainEqual({
      href: 'https://ogabassey.com/laptops/brands/apple/families/macbook-air',
      label: 'MacBook Air laptops',
      productCount: 3,
    });
    expect(page?.familyLinks).not.toContainEqual(
      expect.objectContaining({
        href: expect.stringContaining('macbook-pro'),
      })
    );
  });
});
