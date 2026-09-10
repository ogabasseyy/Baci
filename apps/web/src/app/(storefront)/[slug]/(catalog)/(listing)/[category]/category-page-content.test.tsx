import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBuildCategoryPageHubModel,
  mockBuildRequestScopedStoreUrl,
  mockCategoryPageDeferredCompareLinks,
  mockBuildStoreUrl,
  mockGenerateBreadcrumbSchema,
  mockGenerateCollectionPageSchema,
  mockGenerateFAQSchema,
  mockGetCachedCategoryPageData,
  mockGetCachedBrandAuthorityEntries,
  mockGetCachedProductSemanticInventory,
  mockGetMerchantByIdentifier,
  mockGetPublishedClusterPosts,
  mockHasMaintainedCategoryCompareHubLink,
  mockHeaders,
  mockNormalizeCategoryPageProducts,
  mockResolveCategoryPageName,
} = vi.hoisted(() => ({
  mockBuildCategoryPageHubModel: vi.fn(),
  mockBuildRequestScopedStoreUrl: vi.fn(),
  mockCategoryPageDeferredCompareLinks: vi.fn(),
  mockBuildStoreUrl: vi.fn(),
  mockGenerateBreadcrumbSchema: vi.fn(() => ({})),
  mockGenerateCollectionPageSchema: vi.fn(() => ({})),
  mockGenerateFAQSchema: vi.fn(() => ({})),
  mockGetCachedCategoryPageData: vi.fn(),
  mockGetCachedBrandAuthorityEntries: vi.fn(),
  mockGetCachedProductSemanticInventory: vi.fn(),
  mockGetMerchantByIdentifier: vi.fn(),
  mockGetPublishedClusterPosts: vi.fn(),
  mockHasMaintainedCategoryCompareHubLink: vi.fn(),
  mockHeaders: vi.fn(),
  mockNormalizeCategoryPageProducts: vi.fn(),
  mockResolveCategoryPageName: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

vi.mock('@/components/storefront/ogabassey/pages/category-page', () => ({
  CategoryPage: ({
    currentPage,
    productsArePrePaginated,
    totalProductCount,
    products,
  }: {
    currentPage?: number;
    productsArePrePaginated?: boolean;
    totalProductCount?: number;
    products?: Array<{ id: string; name: string; price: string }>;
  }) => (
    <section aria-label="Category page">
      Category page
      {currentPage ? <div>Page: {currentPage}</div> : null}
      {totalProductCount ? <div>Total: {totalProductCount}</div> : null}
      {productsArePrePaginated ? <div>Prepaginated</div> : null}
      {products?.map((product) => (
        <div key={product.id}>
          {product.name}: {product.price}
        </div>
      ))}
    </section>
  ),
}));

vi.mock('@/components/ui/skeletons', () => ({
  ProductGridSkeleton: () => null,
}));

vi.mock(
  '@/components/storefront/ogabassey/providers/v2-comparison-scope',
  () => ({
    V2ComparisonScope: ({
      children,
      storageNamespace,
    }: {
      children: ReactNode;
      storageNamespace?: string | null;
    }) => (
      <div
        data-storage-namespace={storageNamespace ?? ''}
        data-testid="comparison-scope"
      >
        {children}
      </div>
    ),
  })
);

vi.mock('./category-page-deferred-compare-links', () => ({
  CategoryPageDeferredCompareLinks: (props: { categorySlug: string }) => {
    mockCategoryPageDeferredCompareLinks(props);

    return (
      <section aria-label="Maintained category compare links">
        {props.categorySlug}
      </section>
    );
  },
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedCategoryPageData: (...args: unknown[]) =>
    mockGetCachedCategoryPageData(...args),
  getMerchantByIdentifier: (...args: unknown[]) =>
    mockGetMerchantByIdentifier(...args),
}));

vi.mock('@/lib/sanitize-json-ld', () => ({
  safeJsonLdStringify: (value: unknown) => JSON.stringify(value),
}));

vi.mock('@/lib/seo-utils', () => ({
  generateBreadcrumbSchema: mockGenerateBreadcrumbSchema,
  generateCollectionPageSchema: mockGenerateCollectionPageSchema,
  generateFAQSchema: mockGenerateFAQSchema,
}));

vi.mock('@/lib/store-url', () => ({
  buildRequestScopedStoreUrl: (...args: unknown[]) =>
    mockBuildRequestScopedStoreUrl(...args),
  buildStoreUrl: (...args: unknown[]) => mockBuildStoreUrl(...args),
}));

vi.mock('@/lib/storefront-category/get-cached-brand-authority-entries', () => ({
  getCachedBrandAuthorityEntries: (...args: unknown[]) =>
    mockGetCachedBrandAuthorityEntries(...args),
}));

vi.mock('@/lib/storefront-content/get-published-cluster-posts', () => ({
  getPublishedClusterPosts: (...args: unknown[]) =>
    mockGetPublishedClusterPosts(...args),
}));

vi.mock(
  '@/lib/storefront-product/get-cached-product-semantic-inventory',
  () => ({
    getCachedProductSemanticInventory: (...args: unknown[]) =>
      mockGetCachedProductSemanticInventory(...args),
  })
);

vi.mock('@/lib/validation', () => ({
  isDomainIdentifier: (value: string) => value.includes('.'),
}));

vi.mock('./category-page-content-helpers', () => ({
  STOREFRONT_PRODUCTS_PER_PAGE: 24,
  buildCategoryPageHubModel: (...args: unknown[]) =>
    mockBuildCategoryPageHubModel(...args),
  getCategoryPageProductSlots: (data: {
    productSlots?: unknown[];
    products: unknown[];
  }) => data.productSlots ?? data.products,
  hasMaintainedCategoryCompareHubLink: (...args: unknown[]) =>
    mockHasMaintainedCategoryCompareHubLink(...args),
  isCategoryPageProductSlot: (product: unknown) => product !== null,
  normalizeCategoryPageProducts: (...args: unknown[]) =>
    mockNormalizeCategoryPageProducts(...args),
  resolveCategoryPageName: (...args: unknown[]) =>
    mockResolveCategoryPageName(...args),
  toCollectionSchemaProduct: (product: unknown) => product,
}));

const { CategoryPageContent } = await import('./category-page-content');

describe('CategoryPageContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders.mockResolvedValue(new Headers());
    mockBuildStoreUrl.mockReturnValue('https://store.example.com');
    mockBuildRequestScopedStoreUrl.mockReturnValue('https://store.example.com');
    mockGetPublishedClusterPosts.mockResolvedValue([]);
    mockGetCachedProductSemanticInventory.mockResolvedValue([]);
    mockHasMaintainedCategoryCompareHubLink.mockReturnValue(false);
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: true,
      category: null,
      products: [{ id: 'product-1' }],
    });
    mockGetCachedBrandAuthorityEntries.mockResolvedValue([]);
    mockResolveCategoryPageName.mockReturnValue('Phones');
    mockNormalizeCategoryPageProducts.mockReturnValue([
      {
        id: 'product-1',
        name: 'Phone',
        description: 'Phone description',
        rawPrice: 250000,
        stock: 5,
        image: 'https://cdn.example.com/phone.png',
        brand: 'Brand',
        category: 'Phones',
        category_slug: 'phones',
        slug: 'phone',
        condition: 'new',
      },
    ]);
    mockBuildCategoryPageHubModel.mockReturnValue({
      intro: { heading: 'Phones', description: 'Phone collection' },
      trustFeatures: [],
      faqItems: [],
    });
  });

  it('renders collection, breadcrumb, and FAQ JSON-LD through the shared JsonLd component', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: 'NG',
      payout_currency: 'NGN',
    });
    mockBuildCategoryPageHubModel.mockReturnValueOnce({
      intro: { heading: 'Phones', description: 'Phone collection' },
      trustFeatures: [],
      faqItems: [
        {
          question: 'Do these phones have warranty?',
          answer: 'Yes, eligible phones include warranty coverage.',
        },
      ],
    });
    mockGenerateCollectionPageSchema.mockReturnValueOnce({
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'Phones collection',
    });
    mockGenerateBreadcrumbSchema.mockReturnValueOnce({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
    });
    mockGenerateFAQSchema.mockReturnValueOnce({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
    });

    const ui = await CategoryPageContent({
      params: Promise.resolve({ slug: 'demo-store', category: 'phones' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    const { container } = render(ui);
    const schemaScripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );

    expect(schemaScripts).toHaveLength(3);
    expect(schemaScripts[0]?.textContent).toContain('"@type":"CollectionPage"');
    expect(schemaScripts[1]?.textContent).toContain('"@type":"BreadcrumbList"');
    expect(schemaScripts[2]?.textContent).toContain('"@type":"FAQPage"');
    expect(
      screen.getByRole('heading', { name: 'Buying Phones on Demo Store' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/compare the product name, brand, price/i)
    ).toBeInTheDocument();
    expect(mockGetCachedBrandAuthorityEntries).not.toHaveBeenCalled();
  });

  it('passes the merchant payout currency into collection schema generation', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: 'KE',
      payout_currency: 'KES',
    });

    await CategoryPageContent({
      params: Promise.resolve({ slug: 'demo-store', category: 'phones' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(mockGenerateCollectionPageSchema).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'KES' })
    );
  });

  it('loads bounded guide candidates with the supported category context', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: 'NG',
      payout_currency: 'NGN',
    });

    await CategoryPageContent({
      params: Promise.resolve({
        slug: 'demo-store',
        category: 'smartphones',
      }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(mockGetPublishedClusterPosts).toHaveBeenCalledWith('merchant-1', {
      pageKind: 'category',
      categorySlug: 'smartphones',
    });
  });

  it('keeps category support fallback links when maintained compare graph is empty', async () => {
    mockGetCachedCategoryPageData.mockResolvedValueOnce({
      isCollection: false,
      category: {
        id: 'cat-1',
        name: 'Phones',
        slug: 'phones',
        description: 'Phones',
        image_url: null,
        is_active: true,
        parent_id: null,
        seo_heading: null,
        seo_description: null,
        seo_features: null,
        seo_faq: null,
        parent: null,
      },
      fallbackName: 'Phones',
      fallbackDescription: 'Phones',
      isInactiveCategory: false,
      productCount: 1,
      productsArePrePaginated: true,
      products: [{ id: 'product-1' }],
      productSlots: [{ id: 'product-1' }],
      productIdsQueryFailed: false,
      productsQueryFailed: false,
      categoryQueryFailed: false,
    });

    await CategoryPageContent({
      params: Promise.resolve({ slug: 'demo-store', category: 'phones' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    const hubModelInput = mockBuildCategoryPageHubModel.mock.calls.at(-1)?.[0];

    expect(hubModelInput).not.toHaveProperty('comparisonLinks');
    expect(mockGetCachedProductSemanticInventory).not.toHaveBeenCalled();
  });

  it('renders maintained compare links even when legacy support links exist', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: 'NG',
      payout_currency: 'NGN',
    });
    mockGetCachedCategoryPageData.mockResolvedValueOnce({
      isCollection: false,
      category: {
        id: 'cat-1',
        name: 'Phones',
        slug: 'phones',
        description: 'Phones',
        image_url: null,
        is_active: true,
        parent_id: null,
        seo_heading: null,
        seo_description: null,
        seo_features: null,
        seo_faq: null,
        parent: null,
      },
      fallbackName: 'Phones',
      fallbackDescription: 'Phones',
      isInactiveCategory: false,
      productCount: 1,
      productsArePrePaginated: true,
      products: [{ id: 'product-1' }],
      productSlots: [{ id: 'product-1' }],
      productIdsQueryFailed: false,
      productsQueryFailed: false,
      categoryQueryFailed: false,
    });
    mockBuildCategoryPageHubModel.mockReturnValueOnce({
      intro: { heading: 'Phones', description: 'Phone collection' },
      trustFeatures: [],
      faqItems: [],
      comparisonLinks: [
        {
          href: '/phones/compare/legacy-a-vs-legacy-b',
          label: 'Legacy comparison',
        },
      ],
    });

    render(
      await CategoryPageContent({
        params: Promise.resolve({ slug: 'demo-store', category: 'phones' }),
        searchParams: Promise.resolve({ page: '1' }),
      })
    );

    expect(
      screen.getByRole('region', {
        name: 'Maintained category compare links',
      })
    ).toHaveTextContent('phones');
    expect(mockCategoryPageDeferredCompareLinks).toHaveBeenCalledWith(
      expect.objectContaining({
        categorySlug: 'phones',
        categoryName: 'Phones',
      })
    );
  });

  it('renders category product prices with the merchant country currency', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: 'IN',
      payout_currency: 'INR',
    });
    mockNormalizeCategoryPageProducts.mockImplementation(
      (_products, _category, country) => [
        {
          id: 'product-1',
          name: 'Phone',
          description: 'Phone description',
          price: country === 'IN' ? '₹2,500' : '₦2,500',
          rawPrice: 2500,
          stock: 5,
          image: 'https://cdn.example.com/phone.png',
          brand: 'Brand',
          category: 'Phones',
          category_slug: 'phones',
          slug: 'phone',
          condition: 'new',
        },
      ]
    );

    const ui = await CategoryPageContent({
      params: Promise.resolve({ slug: 'demo-store', category: 'phones' }),
      searchParams: Promise.resolve({ page: '1' }),
    });
    render(ui);

    expect(mockNormalizeCategoryPageProducts).toHaveBeenCalledWith(
      [{ id: 'product-1' }],
      'phones',
      'IN'
    );
    expect(screen.getByText('Phone: ₹2,500')).toBeInTheDocument();
    expect(screen.queryByText(/₦/)).not.toBeInTheDocument();
  });

  it("falls back to 'NGN' when merchant payout currency is missing", async () => {
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: null,
      payout_currency: null,
    });

    await CategoryPageContent({
      params: Promise.resolve({ slug: 'demo-store', category: 'phones' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(mockGenerateCollectionPageSchema).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'NGN' })
    );
  });

  it('calls notFound() when the merchant lookup returns null', async () => {
    // The merchant slug does not resolve — page should 404, not render.
    mockGetMerchantByIdentifier.mockResolvedValue(null);

    await expect(
      CategoryPageContent({
        params: Promise.resolve({
          slug: 'unknown-merchant',
          category: 'phones',
        }),
        searchParams: Promise.resolve({ page: '1' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    // Downstream schema generation should never run for a 404 response.
    expect(mockGenerateCollectionPageSchema).not.toHaveBeenCalled();
    expect(mockGetCachedCategoryPageData).not.toHaveBeenCalled();
  });

  it('keeps missing merchants hard-404 even when the requested page parameter is invalid', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue(null);

    await expect(
      CategoryPageContent({
        params: Promise.resolve({
          slug: 'unknown-merchant',
          category: 'phones',
        }),
        searchParams: Promise.resolve({ page: 'invalid' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockGetCachedCategoryPageData).not.toHaveBeenCalled();
  });

  it('renders category not-found content for a repeatedly percent-encoded category slug without hitting the cached category lookup', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: 'NG',
      payout_currency: 'NGN',
    });
    let overEncodedCategory = 'x y';
    for (let index = 0; index < 10; index += 1) {
      overEncodedCategory = encodeURIComponent(overEncodedCategory);
    }

    render(
      await CategoryPageContent({
        params: Promise.resolve({
          slug: 'demo-store',
          category: overEncodedCategory,
        }),
        searchParams: Promise.resolve({ page: '1' }),
      })
    );

    expect(
      screen.getByRole('heading', { name: 'Category not found' })
    ).toBeInTheDocument();
    // The merchant-existence hard-404 still runs first; only the cached
    // category lookup must be skipped.
    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('demo-store');
    expect(mockGetCachedCategoryPageData).not.toHaveBeenCalled();
    expect(mockGenerateCollectionPageSchema).not.toHaveBeenCalled();
  });

  it('renders category not-found content for an over-long category slug without hitting the cached category lookup', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: 'NG',
      payout_currency: 'NGN',
    });

    render(
      await CategoryPageContent({
        params: Promise.resolve({
          slug: 'demo-store',
          category: 'a'.repeat(4000),
        }),
        searchParams: Promise.resolve({ page: '1' }),
      })
    );

    expect(
      screen.getByRole('heading', { name: 'Category not found' })
    ).toBeInTheDocument();
    expect(mockGetCachedCategoryPageData).not.toHaveBeenCalled();
  });

  it('keeps missing merchants hard-404 even when the category slug is unsafe', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue(null);

    await expect(
      CategoryPageContent({
        params: Promise.resolve({
          slug: 'unknown-merchant',
          category: 'a'.repeat(4000),
        }),
        searchParams: Promise.resolve({ page: '1' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockGetCachedCategoryPageData).not.toHaveBeenCalled();
  });

  it('renders stable noindex soft-not-found content for an unknown category slug with no products', async () => {
    // Unknown/typo slug: merchant resolves, but the category data has no
    // collection, no category row, and no fuzzy-matched products. Metadata stays
    // noindex; content must not throw inside the streamed route boundary.
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: 'NG',
      payout_currency: 'NGN',
    });
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      category: null,
      products: [],
      isInactiveCategory: false,
    });

    render(
      await CategoryPageContent({
        params: Promise.resolve({
          slug: 'demo-store',
          category: 'totally-made-up-slug',
        }),
        searchParams: Promise.resolve({ page: '1' }),
      })
    );

    expect(
      screen.getByRole('heading', { name: 'Category not found' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Continue shopping' })
    ).toHaveAttribute('href', '/demo-store');
    expect(mockGenerateCollectionPageSchema).not.toHaveBeenCalled();
  });

  it('fails open for out-of-range content pages when product ID pagination is unknown', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: 'NG',
      payout_currency: 'NGN',
    });
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      category: { id: 'cat-1', name: 'Phones', slug: 'phones' },
      products: [],
      fallbackName: 'Phones',
      fallbackDescription: 'Phones',
      isInactiveCategory: false,
      productIdsQueryFailed: true,
      productsQueryFailed: true,
    });
    mockNormalizeCategoryPageProducts.mockReturnValue([]);

    const ui = await CategoryPageContent({
      params: Promise.resolve({ slug: 'demo-store', category: 'phones' }),
      searchParams: Promise.resolve({ page: '3' }),
    });

    render(ui);

    expect(
      screen.getByRole('region', { name: 'Category page' })
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, node) => node?.textContent === 'Page: 3')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Category page not found' })
    ).not.toBeInTheDocument();
  });

  it('keeps the requested page when detail chunks fail but ID slots prove pagination', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: 'NG',
      payout_currency: 'NGN',
    });
    const pageTwoProduct = {
      id: 'product-25',
      name: 'Recovered Phone',
      price: 250000,
    };
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      category: { id: 'cat-1', name: 'Phones', slug: 'phones' },
      products: [pageTwoProduct],
      productSlots: [...Array.from({ length: 24 }, () => null), pageTwoProduct],
      fallbackName: 'Phones',
      fallbackDescription: 'Phones',
      isInactiveCategory: false,
      productIdsQueryFailed: false,
      productsQueryFailed: true,
    });
    mockNormalizeCategoryPageProducts.mockImplementation((products) =>
      (products as (typeof pageTwoProduct)[]).map((product) => ({
        id: product.id,
        name: product.name,
        price: '₦250,000',
        rawPrice: product.price,
        stock: 1,
        image: '',
        category: 'Phones',
        category_slug: 'phones',
        slug: product.id,
        condition: 'new',
      }))
    );

    const ui = await CategoryPageContent({
      params: Promise.resolve({ slug: 'demo-store', category: 'phones' }),
      searchParams: Promise.resolve({ page: '2' }),
    });

    render(ui);

    expect(mockGetCachedCategoryPageData).toHaveBeenCalledWith(
      'merchant-1',
      'phones',
      'demo-store',
      20,
      20
    );
    expect(
      screen.getByText((_, node) => node?.textContent === 'Page: 2')
    ).toBeInTheDocument();
    expect(screen.getByText('Total: 25')).toBeInTheDocument();
    expect(screen.getByText('Prepaginated')).toBeInTheDocument();
    expect(screen.getByText('Recovered Phone: ₦250,000')).toBeInTheDocument();
  });

  it('wraps category products in the comparison scope required by product cards', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: null,
      payout_currency: null,
    });

    const ui = await CategoryPageContent({
      params: Promise.resolve({ slug: 'demo-store', category: 'phones' }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    render(ui);

    expect(screen.getByTestId('comparison-scope')).toContainElement(
      screen.getByRole('region', { name: 'Category page' })
    );
    expect(screen.getByTestId('comparison-scope')).toHaveAttribute(
      'data-storage-namespace',
      'merchant-1'
    );
  });
});
