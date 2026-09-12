import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadComparePage } from './load-compare-page';

const mockGetMerchantByIdentifier = vi.fn();
const mockGetCachedCompareCategoryInventory = vi.fn();
const mockGetCachedProductWithDetails = vi.fn();
const mockGetCachedFeatureSettings = vi.fn();
const mockGetPublishedClusterPosts = vi.fn();
vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: (...args: unknown[]) =>
    mockGetMerchantByIdentifier(...args),
  getCachedProductWithDetails: (...args: unknown[]) =>
    mockGetCachedProductWithDetails(...args),
  getCachedFeatureSettings: (...args: unknown[]) =>
    mockGetCachedFeatureSettings(...args),
}));

vi.mock('./get-cached-compare-category-inventory', () => ({
  COMPARE_CATEGORY_INVENTORY_PRODUCT_LIMIT: 600,
  getCachedCompareCategoryInventory: (...args: unknown[]) =>
    mockGetCachedCompareCategoryInventory(...args),
}));

vi.mock('@/lib/storefront-content/get-published-cluster-posts', () => ({
  getPublishedClusterPosts: (...args: unknown[]) =>
    mockGetPublishedClusterPosts(...args),
}));

const merchant = {
  id: 'merchant-1',
  slug: 'ogabassey',
  business_name: 'Ogabassey',
  payout_currency: 'NGN',
};

// Detail-shaped fixtures; the inventory projection derives from these below.
const categoryPageData = {
  isCollection: false,
  fallbackName: 'Smartphones',
  products: [
    {
      id: 'product-a',
      slug: 'iphone-17-pro-max',
      name: 'iPhone 17 Pro Max',
      category: 'Smartphones',
      category_slug: 'smartphones',
      brand: 'Apple',
      price: 2_200_000,
      product_key_specs: { chipset: 'A19 Pro', ram_gb: 8, storage_gb: 256 },
    },
    {
      id: 'product-b',
      slug: 'samsung-galaxy-z-trifold',
      name: 'Samsung Galaxy Z TriFold',
      category: 'Smartphones',
      category_slug: 'smartphones',
      brand: 'Samsung',
      price: 2_300_000,
      product_key_specs: {
        chipset: 'Snapdragon 8 Elite',
        ram_gb: 16,
        storage_gb: 512,
      },
    },
    {
      id: 'product-c',
      slug: 'galaxy-a56',
      name: 'Galaxy A56',
      category: 'Smartphones',
      category_slug: 'smartphones',
      brand: 'Samsung',
      price: 480_000,
      product_key_specs: { chipset: 'Exynos', ram_gb: 8, storage_gb: 128 },
    },
    {
      id: 'product-d',
      slug: 'iphone-16e',
      name: 'iPhone 16e',
      category: 'Smartphones',
      category_slug: 'smartphones',
      brand: 'Apple',
      price: 495_000,
      product_key_specs: { chipset: 'A18', ram_gb: 8, storage_gb: 128 },
    },
    {
      id: 'product-e',
      slug: 'iphone-15',
      name: 'iPhone 15',
      category: 'Smartphones',
      category_slug: 'smartphones',
      brand: 'Apple',
      price: 650_000,
      product_key_specs: { chipset: 'A17', ram_gb: 8, storage_gb: 128 },
    },
    {
      id: 'product-f',
      slug: 'iphone-se',
      name: 'iPhone SE',
      category: 'Smartphones',
      category_slug: 'smartphones',
      brand: 'Apple',
      price: 550_000,
      product_key_specs: { chipset: 'A13', ram_gb: 4, storage_gb: 64 },
    },
    {
      id: 'product-g',
      slug: 'galaxy-s24-fe',
      name: 'Galaxy S24 FE',
      category: 'Smartphones',
      category_slug: 'smartphones',
      brand: 'Samsung',
      price: 700_000,
      product_key_specs: {
        chipset: 'Exynos 2400e',
        ram_gb: 8,
        storage_gb: 256,
      },
    },
    {
      id: 'product-h',
      slug: 'galaxy-a36',
      name: 'Galaxy A36',
      category: 'Smartphones',
      category_slug: 'smartphones',
      brand: 'Samsung',
      price: 360_000,
      product_key_specs: {
        chipset: 'Snapdragon 6 Gen 3',
        ram_gb: 8,
        storage_gb: 128,
      },
    },
  ],
};

function toCompareInventory(data: typeof categoryPageData) {
  return {
    isCollection: data.isCollection,
    fallbackName: data.fallbackName,
    products: data.products.map((product) => ({
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      price: product.price,
      category_slug: product.category_slug,
      status: 'active',
      product_key_specs: product.product_key_specs,
    })),
  };
}

describe('loadComparePage', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    mockGetMerchantByIdentifier.mockReset();
    mockGetCachedCompareCategoryInventory.mockReset();
    mockGetCachedProductWithDetails.mockReset();
    mockGetCachedFeatureSettings.mockReset();
    mockGetPublishedClusterPosts.mockReset();
    mockGetMerchantByIdentifier.mockResolvedValue(merchant);
    mockGetCachedCompareCategoryInventory.mockResolvedValue(
      toCompareInventory(categoryPageData)
    );
    mockGetCachedFeatureSettings.mockResolvedValue({ blog_enabled: false });
    mockGetPublishedClusterPosts.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a canonical product-vs-product page model for eligible products', async () => {
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categoryPageData.products[0],
      product_key_specs: { chipset: 'A19 Pro', ram_gb: 8, storage_gb: 256 },
    });
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categoryPageData.products[1],
      product_key_specs: {
        chipset: 'Snapdragon 8 Elite',
        ram_gb: 16,
        storage_gb: 512,
      },
    });

    const result = await loadComparePage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
    });

    expect(result?.kind).toBe('product');
    expect(result?.canonicalSlug).toBe(
      'iphone-17-pro-max-vs-samsung-galaxy-z-trifold'
    );
    expect(result?.canonicalUrl).toBe(
      'http://localhost:3000/ogabassey/smartphones/compare/iphone-17-pro-max-vs-samsung-galaxy-z-trifold'
    );
    expect(result?.metaTitle).toBe(
      'iPhone 17 Pro Max vs Samsung Galaxy Z TriFold in Nigeria | Ogabassey'
    );
    expect(result?.metaDescription).toContain(
      'Compare iPhone 17 Pro Max vs Samsung Galaxy Z TriFold in Nigeria by price, specs'
    );
    expect(result?.faqItems[0]?.question).toBe(
      'Which is better in Nigeria, iPhone 17 Pro Max or Samsung Galaxy Z TriFold?'
    );
    expect(result?.comparisonRows[0]).toMatchObject({
      label: expect.any(String),
      leftValue: expect.any(String),
      rightValue: expect.any(String),
    });
    expect(result?.breadcrumbItems.at(-1)?.url).toBe(result?.canonicalUrl);
    expect(result?.relatedCompareLinks.length).toBeLessThanOrEqual(6);
    expect(
      result?.relatedCompareLinks.some(
        (link) => link.comparisonSlug === result.canonicalSlug
      )
    ).toBe(false);
  });

  it('keeps full product names in metaTitle when the pair exceeds the SERP display cap', async () => {
    const longLeft = {
      ...categoryPageData.products[0],
      name: 'Samsung Galaxy S26 Ultra 5G Titanium Black 12GB RAM 512GB',
    };
    const longRight = {
      ...categoryPageData.products[1],
      name: 'Samsung Galaxy S26 Ultra 5G Titanium Gray 16GB RAM 1TB Dual SIM',
    };
    mockGetCachedCompareCategoryInventory.mockResolvedValue(
      toCompareInventory({
        ...categoryPageData,
        products: [longLeft, longRight, ...categoryPageData.products.slice(2)],
      })
    );
    mockGetCachedProductWithDetails.mockResolvedValueOnce(longLeft);
    mockGetCachedProductWithDetails.mockResolvedValueOnce(longRight);

    const result = await loadComparePage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
    });

    expect(result?.kind).toBe('product');
    // Distinguishing tail tokens must survive: truncating them collapses
    // distinct comparisons into byte-identical duplicate titles.
    expect(result?.metaTitle).toBe(
      `${longLeft.name} vs ${longRight.name} in Nigeria | Ogabassey`
    );
    expect(result?.metaTitle).not.toContain('...');
  });

  it('returns a canonical brand-vs-brand page model when both brands pass thresholds', async () => {
    const result = await loadComparePage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      comparisonSlug: 'apple-vs-samsung',
    });

    expect(result?.kind).toBe('brand');
    expect(result?.canonicalSlug).toBe('apple-vs-samsung');
    expect(result?.heading).toBe('Apple vs Samsung Smartphones in Nigeria');
    expect(result?.metaDescription).toContain(
      'Compare Apple and Samsung smartphones in Nigeria by live model count'
    );
    expect(result?.summaryVerdict).toMatch(/smartphones shoppers in Nigeria/i);
    expect(result?.faqItems.length).toBeGreaterThan(0);
    expect(result?.comparisonRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Active models' }),
      ])
    );
  });

  it('keeps the full brand-vs-brand metaTitle when a long category name exceeds the SERP display cap', async () => {
    // A long category name pushes "{leftBrand} vs {rightBrand} {category}"
    // past the 60-char SERP display cap; without the higher compare cap the
    // tail is sliced off and distinct brand pages collapse into duplicate
    // titles.
    mockGetCachedCompareCategoryInventory.mockResolvedValue(
      toCompareInventory({
        ...categoryPageData,
        fallbackName: 'Premium Flagship Android and iOS Smartphones',
      })
    );

    const result = await loadComparePage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      comparisonSlug: 'apple-vs-samsung',
    });

    expect(result?.kind).toBe('brand');
    expect(result?.metaTitle).toBe(
      'Apple vs Samsung Premium Flagship Android and iOS Smartphones in Nigeria | Ogabassey'
    );
    expect(result?.metaTitle).not.toContain('...');
  });

  it('keeps product compare pages indexable when detail payloads omit key specs but still expose rich spec rows', async () => {
    const leftDetail = {
      ...categoryPageData.products[0],
      specs: [
        { label: 'Processor', value: 'A19 Pro' },
        { label: 'RAM', value: '8GB' },
        { label: 'Storage', value: '256GB' },
      ],
    };
    const rightDetail = {
      ...categoryPageData.products[1],
      specs: [
        { label: 'Processor', value: 'Snapdragon 8 Elite' },
        { label: 'RAM', value: '16GB' },
        { label: 'Storage', value: '512GB' },
      ],
    };

    mockGetCachedProductWithDetails.mockResolvedValueOnce(leftDetail);
    mockGetCachedProductWithDetails.mockResolvedValueOnce(rightDetail);

    const result = await loadComparePage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
    });

    expect(result?.kind).toBe('product');
    expect(result?.isIndexable).toBe(true);
    expect(result?.canonicalSlug).toBe(
      'iphone-17-pro-max-vs-samsung-galaxy-z-trifold'
    );
    expect(result?.canonicalUrl).toBe(
      'http://localhost:3000/ogabassey/smartphones/compare/iphone-17-pro-max-vs-samsung-galaxy-z-trifold'
    );
  });

  it('marks maintained graph-emitted product compare routes as indexable', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // No fallback warning should be emitted for a graph-emitted pair.
    });

    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categoryPageData.products[5],
      product_key_specs: { chipset: 'A13', ram_gb: 4, storage_gb: 64 },
    });
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categoryPageData.products[1],
      product_key_specs: {
        chipset: 'Snapdragon 8 Elite',
        ram_gb: 16,
        storage_gb: 512,
      },
    });

    const result = await loadComparePage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      comparisonSlug: 'iphone-se-vs-samsung-galaxy-z-trifold',
    });

    expect(result?.kind).toBe('product');
    expect(result?.isIndexable).toBe(true);
    expect(result?.isLegacyFallback).toBe(false);
    expect(result?.canonicalSlug).toBe('iphone-se-vs-samsung-galaxy-z-trifold');
    expect(warnSpy).not.toHaveBeenCalledWith(
      'COMPARE_NON_CURATED_FALLBACK',
      expect.anything()
    );

    warnSpy.mockRestore();
  });

  it('keeps reversed maintained graph product compare routes non-indexable', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // Suppress expected non-canonical fallback warning.
    });
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categoryPageData.products[1],
      product_key_specs: {
        chipset: 'Snapdragon 8 Elite',
        ram_gb: 16,
        storage_gb: 512,
      },
    });
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categoryPageData.products[5],
      product_key_specs: { chipset: 'A13', ram_gb: 4, storage_gb: 64 },
    });

    const result = await loadComparePage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      comparisonSlug: 'samsung-galaxy-z-trifold-vs-iphone-se',
    });

    expect(result?.kind).toBe('product');
    expect(result?.canonicalSlug).toBe('iphone-se-vs-samsung-galaxy-z-trifold');
    expect(result?.isIndexable).toBe(false);
    expect(result?.isLegacyFallback).toBe(true);

    warnSpy.mockRestore();
  });

  it('keeps valid PDP-emitted compare routes indexable when the anchor is outside bounded graph inventory', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // No fallback warning should be emitted for a valid clicked pair.
    });
    // iphone-17-pro-max resolves from the 600-row compare snapshot but sits
    // outside the 300-row graph window. The overflow guard must append the
    // clicked product and rebuild over that request set rather than trusting a
    // category set which never received the clicked product.
    const graphFillerProducts = Array.from({ length: 299 }, (_, index) => ({
      ...categoryPageData.products[2],
      id: `graph-filler-${index}`,
      slug: `graph-filler-${index}`,
      name: `Graph Filler ${index}`,
      product_key_specs: {
        chipset: 'A19 Pro',
        ram_gb: 16,
        storage_gb: 256,
      },
    }));
    mockGetCachedCompareCategoryInventory.mockResolvedValue(
      toCompareInventory({
        ...categoryPageData,
        products: [
          categoryPageData.products[1],
          ...graphFillerProducts,
          categoryPageData.products[0],
        ],
      })
    );
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categoryPageData.products[0],
      product_key_specs: { chipset: 'A19 Pro', ram_gb: 8, storage_gb: 256 },
    });
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categoryPageData.products[1],
      product_key_specs: {
        chipset: 'Snapdragon 8 Elite',
        ram_gb: 16,
        storage_gb: 512,
      },
    });

    const result = await loadComparePage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
    });

    expect(result?.kind).toBe('product');
    expect(result?.isIndexable).toBe(true);
    expect(result?.isLegacyFallback).toBe(false);
    expect(warnSpy).not.toHaveBeenCalledWith(
      'COMPARE_NON_CURATED_FALLBACK',
      expect.anything()
    );

    warnSpy.mockRestore();
  });

  it('rejects an unmaintained compare route before hydrating product details', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // Suppress expected non-maintained fallback warning.
    });
    const inactiveLeft = {
      ...categoryPageData.products[0],
      status: 'draft',
    };
    const activeRight = {
      ...categoryPageData.products[1],
      status: 'active',
    };
    // A draft product must not be approved when the category snapshot carries
    // its current status into both the core and graph overlay.
    const staleInventory = toCompareInventory({
      ...categoryPageData,
      products: [inactiveLeft, activeRight],
    });
    staleInventory.products[0].status = 'draft';
    mockGetCachedCompareCategoryInventory.mockResolvedValue(staleInventory);
    const result = await loadComparePage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
    });

    expect(result).toBeNull();
    expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'COMPARE_ROUTE_404',
      expect.objectContaining({
        reason: 'unapproved_product_compare_route',
      })
    );

    warnSpy.mockRestore();
  });

  it('degrades a bounded-graph-inventory failure to the curated-slug fallback per request without 404ing or caching it', async () => {
    // The graph inventory (related links + graph-based approval) is auxiliary:
    // it is loaded per-request OUTSIDE the remote-cached model, so a transient
    // failure degrades this one request (curated-slug fallback indexability,
    // empty related links) instead of caching a degraded model for the window
    // or 404ing an otherwise-valid compare page.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // Suppress expected bounded-inventory warning.
    });
    mockGetCachedCompareCategoryInventory
      .mockResolvedValueOnce(toCompareInventory(categoryPageData))
      .mockResolvedValueOnce(toCompareInventory(categoryPageData))
      .mockRejectedValueOnce(new Error('inventory timeout'));
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categoryPageData.products[0],
      product_key_specs: { chipset: 'A19 Pro', ram_gb: 8, storage_gb: 256 },
    });
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categoryPageData.products[1],
      product_key_specs: {
        chipset: 'Snapdragon 8 Elite',
        ram_gb: 16,
        storage_gb: 512,
      },
    });

    const result = await loadComparePage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
    });

    expect(result?.kind).toBe('product');
    expect(result?.isIndexable).toBe(true);
    expect(result?.isLegacyFallback).toBe(false);
    expect(result?.relatedCompareLinks).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to load bounded compare graph inventory',
      expect.objectContaining({
        categorySlug: 'smartphones',
        merchantId: 'merchant-1',
      })
    );

    warnSpy.mockRestore();
  });

  it('builds graph approval from the compare snapshot for a maintained non-curated route', async () => {
    // Regression guard: graph membership and related links derive from the same
    // Cache Components category snapshot as the compare core. The previous
    // independent semantic query doubled the large Supabase response.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // Suppress unrelated non-curated diagnostics if the contract regresses.
    });
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categoryPageData.products[4],
      product_key_specs: { chipset: 'A17', ram_gb: 8, storage_gb: 128 },
    });
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categoryPageData.products[5],
      product_key_specs: { chipset: 'A13', ram_gb: 4, storage_gb: 64 },
    });

    const result = await loadComparePage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      comparisonSlug: 'iphone-15-vs-iphone-se',
    });

    expect(result?.kind).toBe('product');
    expect(result?.isIndexable).toBe(true);
    expect(result?.isLegacyFallback).toBe(false);
    // Proves the decision came from the graph, not the curated fallback.
    expect(warnSpy).not.toHaveBeenCalledWith(
      'COMPARE_NON_CURATED_FALLBACK',
      expect.anything()
    );
    expect(warnSpy).not.toHaveBeenCalledWith(
      'Failed to load bounded compare graph inventory',
      expect.anything()
    );

    warnSpy.mockRestore();
  });

  it('degrades a guide-post load failure to empty guide links per request without 404ing the page', async () => {
    // Buyer-guide links are auxiliary and loaded per-request outside the cache
    // (loadPublishedClusterPostsSafely degrades to [] by contract). A transient
    // guide-RPC failure must not cache empty guideLinks for the window, nor
    // 404 the compare page — it renders with guideLinks: [].
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // Suppress expected guide-load warning.
    });
    mockGetPublishedClusterPosts.mockRejectedValueOnce(
      new Error('guide rpc timeout')
    );
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categoryPageData.products[0],
      product_key_specs: { chipset: 'A19 Pro', ram_gb: 8, storage_gb: 256 },
    });
    mockGetCachedProductWithDetails.mockResolvedValueOnce({
      ...categoryPageData.products[1],
      product_key_specs: {
        chipset: 'Snapdragon 8 Elite',
        ram_gb: 16,
        storage_gb: 512,
      },
    });

    const result = await loadComparePage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
    });

    expect(result?.kind).toBe('product');
    expect(result?.guideLinks).toEqual([]);
    expect(result?.isIndexable).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to load bounded storefront guide candidates',
      expect.objectContaining({ merchantId: 'merchant-1' })
    );

    warnSpy.mockRestore();
  });

  it('returns null when the identifier resolves to a different merchant inside the cached model than for the caller', async () => {
    // Outer per-request resolution (which forms the cache key) sees
    // merchant-1 …
    mockGetMerchantByIdentifier.mockResolvedValueOnce(merchant);
    // … but by the time the cached fill re-resolves the identifier, the slug
    // has been reassigned to another tenant (slug rename + reuse, or custom
    // domain reassignment). The cached builder must refuse to build a model
    // for the mismatched tenant instead of serving cross-tenant content.
    mockGetMerchantByIdentifier.mockResolvedValueOnce({
      ...merchant,
      id: 'merchant-2',
    });

    const result = await loadComparePage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
    });

    expect(result).toBeNull();
    expect(mockGetCachedCompareCategoryInventory).not.toHaveBeenCalled();
  });

  it('cannot resolve a compare page for a product outside the bounded ~600-row resolver universe', async () => {
    // getCachedCompareCategoryInventory hard-caps the category to the newest
    // COMPARE_CATEGORY_INVENTORY_PRODUCT_LIMIT (600) products, ordered
    // created_at DESC, id ASC. A product beyond that cap is simply absent from
    // the resolver's `products` array, so load-compare-page's leftProduct/
    // rightProduct `.find()` on that bounded array can never match it — the
    // request falls through to the brand path, misses, and returns null (a real
    // 404 at the route). This models "candidate 601": present in the catalog but
    // truncated out of the bounded universe, therefore unable to mint/resolve a
    // compare URL even if the slug is typed or crawled directly.
    mockGetCachedCompareCategoryInventory.mockResolvedValue(
      toCompareInventory(categoryPageData)
    );

    const result = await loadComparePage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      // 'iphone-17-pro-max' IS in the bounded universe; 'legacy-product-601' was
      // truncated by the 600-row cap and is absent from it.
      comparisonSlug: 'iphone-17-pro-max-vs-legacy-product-601',
    });

    expect(result).toBeNull();
    // Resolution stops before hydrating either product's detail payload: the
    // out-of-universe half is never a `leftProduct`/`rightProduct`, so the
    // product-detail branch is never entered.
    expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
  });

  it('returns null without hydrating details for an existing pair absent from the maintained route manifest', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // Suppress the expected route-containment warning.
    });
    const unapprovedLeft = {
      ...categoryPageData.products[0],
      slug: 'unapproved-left',
      name: 'Unapproved Left',
      product_key_specs: { chipset: 'A19 Pro', ram_gb: 8, storage_gb: 256 },
    };
    const unapprovedRight = {
      ...categoryPageData.products[1],
      slug: 'unapproved-right',
      name: 'Unapproved Right',
      product_key_specs: { chipset: 'A19 Pro', ram_gb: 8, storage_gb: 256 },
    };
    mockGetCachedCompareCategoryInventory.mockResolvedValue(
      toCompareInventory({
        ...categoryPageData,
        products: [
          ...categoryPageData.products,
          unapprovedLeft,
          unapprovedRight,
        ],
      })
    );
    mockGetCachedProductWithDetails.mockResolvedValueOnce(unapprovedLeft);
    mockGetCachedProductWithDetails.mockResolvedValueOnce(unapprovedRight);

    const result = await loadComparePage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      comparisonSlug: 'unapproved-left-vs-unapproved-right',
    });

    expect(result).toBeNull();
    expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'COMPARE_ROUTE_404',
      expect.objectContaining({
        reason: 'unapproved_product_compare_route',
      })
    );
    warnSpy.mockRestore();
  });

  describe('slug safety gate', () => {
    const overEncodedSlug = (() => {
      let value = 'x y';
      for (let index = 0; index < 10; index += 1) {
        value = encodeURIComponent(value);
      }
      return value;
    })();
    const overLongSlug = 'a'.repeat(4000);

    it('returns null for a repeatedly percent-encoded category slug without hitting the cached category lookup', async () => {
      const result = await loadComparePage({
        merchantSlug: 'ogabassey',
        categorySlug: overEncodedSlug,
        comparisonSlug: 'apple-vs-samsung',
      });

      expect(result).toBeNull();
      expect(mockGetCachedCompareCategoryInventory).not.toHaveBeenCalled();
      expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
    });

    it('returns null for an over-long category slug without hitting the cached category lookup', async () => {
      const result = await loadComparePage({
        merchantSlug: 'ogabassey',
        categorySlug: overLongSlug,
        comparisonSlug: 'apple-vs-samsung',
      });

      expect(result).toBeNull();
      expect(mockGetCachedCompareCategoryInventory).not.toHaveBeenCalled();
    });

    it('returns null when a parsed compare half is over-long, before the cached lookups', async () => {
      const result = await loadComparePage({
        merchantSlug: 'ogabassey',
        categorySlug: 'smartphones',
        comparisonSlug: `${overLongSlug}-vs-${overLongSlug}`,
      });

      expect(result).toBeNull();
      expect(mockGetCachedCompareCategoryInventory).not.toHaveBeenCalled();
      expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
    });

    it('does NOT 404 a legitimate long composite compare slug (two <=200-char product slugs)', async () => {
      // Each half is a valid single product slug (~131 chars, <=200); the
      // composite (~266 chars) exceeds the single-slug 255 cap but must NOT be
      // gated — the parsed halves are each within bound, so the category lookup
      // still runs. Regression test for the composite-length false positive.
      const longLeft = `aa${'-bb'.repeat(43)}`;
      const longRight = `cc${'-dd'.repeat(43)}`;

      await loadComparePage({
        merchantSlug: 'ogabassey',
        categorySlug: 'smartphones',
        comparisonSlug: `${longLeft}-vs-${longRight}`,
      });

      expect(mockGetCachedCompareCategoryInventory).toHaveBeenCalledWith(
        'merchant-1',
        'smartphones'
      );
    });

    it('still resolves a valid short slug through the cached category lookup', async () => {
      const result = await loadComparePage({
        merchantSlug: 'ogabassey',
        categorySlug: 'smartphones',
        comparisonSlug: 'apple-vs-samsung',
      });

      expect(mockGetCachedCompareCategoryInventory).toHaveBeenCalledWith(
        'merchant-1',
        'smartphones'
      );
      expect(result?.kind).toBe('brand');
    });
  });

  it('degrades a transient product-detail failure to a per-request null without caching it', async () => {
    // getCachedProductWithDetails returns null on transient query errors; the
    // cached model builder must THROW (so Cache Components never stores a
    // cached 404 for the revalidate window) and the per-request wrapper must
    // degrade that single request to null.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      // Suppress expected model-failure log.
    });
    mockGetCachedProductWithDetails.mockResolvedValue(null);

    const result = await loadComparePage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
    });

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to load compare page model',
      expect.objectContaining({
        comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        error: expect.objectContaining({
          message: expect.stringContaining(
            'Compare product details unavailable'
          ),
        }),
      })
    );

    errorSpy.mockRestore();
  });

  it('resolves compare pages from custom-domain storefront identifiers', async () => {
    mockGetMerchantByIdentifier.mockResolvedValueOnce({
      ...merchant,
      custom_domain: 'ogabassey.com',
    });

    const result = await loadComparePage({
      merchantSlug: 'ogabassey.com',
      categorySlug: 'smartphones',
      comparisonSlug: 'apple-vs-samsung',
    });

    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('ogabassey.com');
    expect(mockGetCachedCompareCategoryInventory).toHaveBeenCalledWith(
      merchant.id,
      'smartphones'
    );
    expect(result?.kind).toBe('brand');
  });
});
