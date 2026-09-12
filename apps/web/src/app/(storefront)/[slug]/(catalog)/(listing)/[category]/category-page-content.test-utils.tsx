import type { ReactNode } from 'react';
import { vi } from 'vitest';

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

export {
  mockBuildCategoryPageHubModel,
  mockBuildRequestScopedStoreUrl,
  mockBuildStoreUrl,
  mockCategoryPageDeferredCompareLinks,
  mockGenerateBreadcrumbSchema,
  mockGenerateCollectionPageSchema,
  mockGenerateFAQSchema,
  mockGetCachedBrandAuthorityEntries,
  mockGetCachedCategoryPageData,
  mockGetCachedProductSemanticInventory,
  mockGetMerchantByIdentifier,
  mockGetPublishedClusterPosts,
  mockHasMaintainedCategoryCompareHubLink,
  mockHeaders,
  mockNormalizeCategoryPageProducts,
  mockResolveCategoryPageName,
};

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

export const { CategoryPageContent } = await import('./category-page-content');

export function resetCategoryPageContentMocks() {
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
}
