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

  it('fails the hub closed when the brand-scoped product read fails', async () => {
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
    ).resolves.toBeNull();
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
});
