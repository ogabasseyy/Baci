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

  it('builds a canonical indexable hub from matching active inventory', async () => {
    const { brandAuthorityPageLoader } = await import(
      './load-brand-authority-page'
    );
    const page = await brandAuthorityPageLoader.load(
      {
        merchantSlug: 'ogabassey',
        categorySlug: 'smartphones',
        brandSlug: 'samsung',
      },
      { includeRequestPathPrefix: false }
    );

    expect(page).toMatchObject({
      canonicalUrl: 'https://ogabassey.com/smartphones/brands/samsung',
      heading: 'Samsung Phones and Prices in Nigeria',
      categoryName: 'Smartphones',
      pathPrefix: '',
    });
    expect(page?.products).toHaveLength(6);
    expect(page?.breadcrumbItems).toHaveLength(3);
    expect(mockGetCategory).toHaveBeenCalledWith('merchant-1', 'smartphones');
    expect(mockLoadPublishedClusterPostsSafely).toHaveBeenCalledWith(
      'merchant-1',
      expect.objectContaining({
        pageKind: 'category',
        categorySlug: 'smartphones',
        brands: ['Samsung', 'samsung'],
        productSlugs: Array.from(
          { length: 6 },
          (_, index) => `samsung-phone-${index}`
        ),
      })
    );
  });

  it('passes grouped authority aliases to commercial guide matching', async () => {
    mockGetCachedBrandAuthorityProducts.mockResolvedValue(
      Array.from({ length: 6 }, (_, index) => makeProduct(index, 'Redmi'))
    );
    const { brandAuthorityPageLoader } = await import(
      './load-brand-authority-page'
    );

    await brandAuthorityPageLoader.load(
      {
        merchantSlug: 'ogabassey',
        categorySlug: 'smartphones',
        brandSlug: 'xiaomi',
      },
      { includeRequestPathPrefix: false }
    );

    expect(mockLoadPublishedClusterPostsSafely).toHaveBeenCalledWith(
      'merchant-1',
      expect.objectContaining({
        brands: ['Xiaomi and Redmi', 'xiaomi', 'Redmi'],
        productNames: Array.from(
          { length: 6 },
          (_, index) => `Redmi Phone ${index}`
        ),
      })
    );
  });

  it('links the Infinix HOT family when two current models are available', async () => {
    mockGetCachedBrandAuthorityProducts.mockResolvedValue([
      { ...makeProduct(1, 'Infinix'), name: 'Infinix Hot 70' },
      { ...makeProduct(2, 'Infinix'), name: 'Infinix Hot 70 Pro' },
      { ...makeProduct(3, 'Infinix'), name: 'Infinix Note 60' },
      { ...makeProduct(4, 'Infinix'), name: 'Infinix Note 60 Pro' },
      { ...makeProduct(5, 'Infinix'), name: 'Infinix Smart 20' },
    ]);
    const { brandAuthorityPageLoader } = await import(
      './load-brand-authority-page'
    );

    const page = await brandAuthorityPageLoader.load({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      brandSlug: 'infinix',
    });

    expect(page?.familyLinks).toContainEqual({
      href: 'https://ogabassey.com/smartphones/brands/infinix/families/hot',
      label: 'Infinix HOT phones',
      productCount: 2,
    });
  });

  it('rejects uncurated and thin brand pages', async () => {
    const { brandAuthorityPageLoader } = await import(
      './load-brand-authority-page'
    );

    await expect(
      brandAuthorityPageLoader.load({
        merchantSlug: 'ogabassey',
        categorySlug: 'smartphones',
        brandSlug: 'unknown',
      })
    ).resolves.toBeNull();

    mockGetCachedBrandAuthorityProducts.mockResolvedValueOnce(
      Array.from({ length: 4 }, (_, index) => makeProduct(index))
    );

    await expect(
      brandAuthorityPageLoader.load({
        merchantSlug: 'ogabassey',
        categorySlug: 'smartphones',
        brandSlug: 'samsung',
      })
    ).resolves.toBeNull();
  });

  it('counts only in-stock products toward indexability and published copy', async () => {
    mockGetCachedBrandAuthorityProducts.mockResolvedValue([
      ...Array.from({ length: 5 }, (_, index) => makeProduct(index)),
      { ...makeProduct(6), availability: 'OutOfStock' as const, stock: 0 },
    ]);
    const { brandAuthorityPageLoader } = await import(
      './load-brand-authority-page'
    );

    const page = await brandAuthorityPageLoader.load({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      brandSlug: 'samsung',
    });

    expect(page?.products).toHaveLength(5);
    expect(page?.intro).toContain('a selection of 5 Samsung phones');
    expect(page?.metaDescription).toContain('a selection of 5 Samsung phones');
  });

  it('propagates database failure when brand-scoped product read fails', async () => {
    mockGetCachedBrandAuthorityProducts.mockRejectedValueOnce(
      new Error('database timeout')
    );
    const { brandAuthorityPageLoader } = await import(
      './load-brand-authority-page'
    );

    await expect(
      brandAuthorityPageLoader.load({
        merchantSlug: 'ogabassey',
        categorySlug: 'smartphones',
        brandSlug: 'samsung',
      })
    ).rejects.toThrow('database timeout');
  });

  it('includes model families appearing after index 48 in familyLinks while capping page.products at 48', async () => {
    const genericProducts = Array.from({ length: 48 }, (_, index) => ({
      ...makeProduct(index, 'Samsung'),
      name: `Samsung Generic Phone ${index}`,
    }));
    const galaxySProducts = [
      { ...makeProduct(48, 'Samsung'), name: 'Galaxy S24' },
      { ...makeProduct(49, 'Samsung'), name: 'Galaxy S25' },
      { ...makeProduct(50, 'Samsung'), name: 'Galaxy S26' },
    ];
    mockGetCachedBrandAuthorityProducts.mockResolvedValueOnce([
      ...genericProducts,
      ...galaxySProducts,
    ]);

    const { brandAuthorityPageLoader } = await import(
      './load-brand-authority-page'
    );

    const page = await brandAuthorityPageLoader.load({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      brandSlug: 'samsung',
    });

    expect(page?.products).toHaveLength(48);
    expect(page?.familyLinks).toContainEqual({
      href: 'https://ogabassey.com/smartphones/brands/samsung/families/galaxy-s',
      label: 'Samsung Galaxy S phones',
      productCount: 3,
    });
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
