import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadBrandPage = vi.fn();
const mockLoadClusterPosts = vi.fn();
vi.mock('@/lib/storefront-category/load-brand-authority-page', () => ({
  brandAuthorityPageLoader: {
    load: (...args: unknown[]) => mockLoadBrandPage(...args),
  },
}));
vi.mock('@/lib/storefront-content/load-published-cluster-posts-safely', () => ({
  loadPublishedClusterPostsSafely: (...args: unknown[]) =>
    mockLoadClusterPosts(...args),
}));

describe('model family authority page loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadClusterPosts.mockResolvedValue([]);
    mockLoadBrandPage.mockResolvedValue({
      canonicalUrl: 'https://store.test/smartphones/brands/samsung',
      merchant: {
        id: 'merchant-id',
        business_name: 'Store',
        country: 'NG',
        slug: 'store',
        custom_domain: null,
      },
      brand: { brandKey: 'samsung', displayName: 'Samsung' },
      products: [
        { name: 'Samsung Galaxy S24', slug: 'samsung-galaxy-s24' },
        { name: 'Samsung Galaxy S25', slug: 'samsung-galaxy-s25' },
        { name: 'Samsung Galaxy S26', slug: 'samsung-galaxy-s26' },
        { name: 'Samsung Galaxy A56', slug: 'samsung-galaxy-a56' },
      ],
      breadcrumbItems: [
        { name: 'Store', url: 'https://store.test' },
        { name: 'Smartphones', url: 'https://store.test/smartphones' },
        {
          name: 'Samsung',
          url: 'https://store.test/smartphones/brands/samsung',
        },
      ],
    });
  });

  it('builds an indexable family page at the inventory threshold', async () => {
    const { modelFamilyAuthorityPageLoader } = await import(
      './load-model-family-authority-page'
    );
    const page = await modelFamilyAuthorityPageLoader.load({
      merchantSlug: 'store',
      categorySlug: 'smartphones',
      brandSlug: 'samsung',
      familySlug: 'galaxy-s',
    });

    expect(page).toMatchObject({
      canonicalUrl:
        'https://store.test/smartphones/brands/samsung/families/galaxy-s',
      heading: 'Samsung Galaxy S Phones and Prices in Nigeria',
    });
    expect(page?.products).toHaveLength(3);
    expect(mockLoadClusterPosts).toHaveBeenCalledWith(
      'merchant-id',
      expect.objectContaining({
        productSlugs: [
          'samsung-galaxy-s24',
          'samsung-galaxy-s25',
          'samsung-galaxy-s26',
        ],
      })
    );
    expect(mockLoadClusterPosts).toHaveBeenCalledTimes(1);
  });

  it('rejects thin and uncurated family pages', async () => {
    const { modelFamilyAuthorityPageLoader } = await import(
      './load-model-family-authority-page'
    );
    expect(
      await modelFamilyAuthorityPageLoader.load({
        merchantSlug: 'store',
        categorySlug: 'smartphones',
        brandSlug: 'samsung',
        familySlug: 'galaxy-z',
      })
    ).toBeNull();
    expect(
      await modelFamilyAuthorityPageLoader.load({
        merchantSlug: 'store',
        categorySlug: 'smartphones',
        brandSlug: 'samsung',
        familySlug: 'unknown',
      })
    ).toBeNull();
  });

  it('keeps the Infinix HOT hub indexable with Hot 70 and Hot 70 Pro', async () => {
    mockLoadBrandPage.mockResolvedValueOnce({
      canonicalUrl: 'https://store.test/smartphones/brands/infinix',
      merchant: {
        id: 'merchant-id',
        business_name: 'Store',
        country: 'NG',
        slug: 'store',
        custom_domain: null,
      },
      brand: { brandKey: 'infinix', displayName: 'Infinix' },
      products: [
        { name: 'Infinix Hot 70', slug: 'infinix-hot-70' },
        { name: 'Infinix Hot 70 Pro', slug: 'infinix-hot-70-pro' },
        { name: 'Infinix Note 60', slug: 'infinix-note-60' },
      ],
      breadcrumbItems: [],
    });
    const { modelFamilyAuthorityPageLoader } = await import(
      './load-model-family-authority-page'
    );
    const page = await modelFamilyAuthorityPageLoader.load({
      merchantSlug: 'store',
      categorySlug: 'smartphones',
      brandSlug: 'infinix',
      familySlug: 'hot',
    });

    expect(page).toMatchObject({
      canonicalUrl:
        'https://store.test/smartphones/brands/infinix/families/hot',
      heading: 'Infinix HOT Phones and Prices in Nigeria',
    });
    expect(page?.products.map((product) => product.slug)).toEqual([
      'infinix-hot-70',
      'infinix-hot-70-pro',
    ]);
  });

  it('builds family page when family products appear after index 48 of brandInventory.products', async () => {
    const genericProducts = Array.from({ length: 48 }, (_, index) => ({
      name: `Samsung Other ${index}`,
      slug: `samsung-other-${index}`,
    }));
    const galaxySProducts = [
      { name: 'Samsung Galaxy S24', slug: 'samsung-galaxy-s24' },
      { name: 'Samsung Galaxy S25', slug: 'samsung-galaxy-s25' },
      { name: 'Samsung Galaxy S26', slug: 'samsung-galaxy-s26' },
    ];
    mockLoadBrandPage.mockResolvedValueOnce({
      canonicalUrl: 'https://store.test/smartphones/brands/samsung',
      merchant: {
        id: 'merchant-id',
        business_name: 'Store',
        country: 'NG',
        slug: 'store',
        custom_domain: null,
      },
      brand: { brandKey: 'samsung', displayName: 'Samsung' },
      products: genericProducts,
      brandInventory: {
        products: [...genericProducts, ...galaxySProducts],
      },
      breadcrumbItems: [],
    });
    const { modelFamilyAuthorityPageLoader } = await import(
      './load-model-family-authority-page'
    );
    const page = await modelFamilyAuthorityPageLoader.load({
      merchantSlug: 'store',
      categorySlug: 'smartphones',
      brandSlug: 'samsung',
      familySlug: 'galaxy-s',
    });

    expect(page).not.toBeNull();
    expect(page?.products).toHaveLength(3);
    expect(page?.products.map((p) => p.slug)).toEqual([
      'samsung-galaxy-s24',
      'samsung-galaxy-s25',
      'samsung-galaxy-s26',
    ]);
  });

  it('propagates DB errors from brand page loader rather than returning null', async () => {
    mockLoadBrandPage.mockRejectedValueOnce(new Error('database error'));
    const { modelFamilyAuthorityPageLoader } = await import(
      './load-model-family-authority-page'
    );

    await expect(
      modelFamilyAuthorityPageLoader.load({
        merchantSlug: 'store',
        categorySlug: 'smartphones',
        brandSlug: 'samsung',
        familySlug: 'galaxy-s',
      })
    ).rejects.toThrow('database error');
  });
});
