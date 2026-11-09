import type { ReactElement } from 'react';
import { vi } from 'vitest';
import type { CategoryHubModel } from '@/lib/storefront-category/category-hub-types';
import { smartphoneHubProducts } from './page.test-fixtures';

export const NORMALIZED_PLACEHOLDER_IMAGE = '/placeholder.svg';
export const mockGetPublishedClusterPosts = vi.fn();
export const mockGetCachedProductSemanticInventory = vi.fn();
export const mockCategoryPageDeferredCompareLinks = vi.fn();
export const mockConnection = vi.fn();
export const mockCategoryPageContent = vi.fn((_props: unknown) => (
  <div>Category page content</div>
));

export function defaultCategoryPageImplementation({
  currentPage,
  hubContent,
}: {
  currentPage?: number;
  hubContent?: CategoryHubModel;
}) {
  return (
    <div>
      <div>Current page: {currentPage}</div>
      <div>Hub heading: {hubContent?.intro.heading ?? 'none'}</div>
      {hubContent?.bestForCards.map((card) => (
        <div key={`best-for-${card.title}-${card.href}`}>
          Best for: {card.title}
        </div>
      ))}
      {hubContent?.brandCards.map((card) => (
        <div key={`brand-${card.title}-${card.href}`}>
          <div>Brand: {card.title}</div>
          {card.secondaryLabel ? (
            <div>Brand compare: {card.secondaryLabel}</div>
          ) : null}
        </div>
      ))}
      {hubContent?.priceBandCards.map((card) => (
        <div key={`price-band-${card.title}-${card.href}`}>
          Price band: {card.title}
        </div>
      ))}
      {hubContent?.comparisonLinks.map((link) => (
        <div key={`compare-link-${link.label}-${link.href}`}>
          Compare link: {link.label}
        </div>
      ))}
      {hubContent?.guideLinks.map((link) => (
        <div key={`guide-link-${link.title}-${link.href}`}>
          Guide link: {link.title}
        </div>
      ))}
      {hubContent?.faqItems.map((item) => (
        <div key={`faq-${item.question}-${item.answer}`}>
          FAQ: {item.question}
        </div>
      ))}
    </div>
  );
}

export const categoryPageSpy = vi.fn(defaultCategoryPageImplementation);
export const mockBuildStoreUrl = vi.fn();
export const mockBuildRequestScopedStoreUrl = vi.fn();
export const mockGenerateBreadcrumbSchema = vi.fn(() => ({}));
export const mockGenerateCollectionPageSchema = vi.fn(() => ({}));
export const mockGenerateFAQSchema = vi.fn((faqItems) => ({
  '@type': 'FAQPage',
  mainEntity: faqItems,
}));
export const mockHeaders = vi.fn();
export const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('@/components/storefront/ogabassey/pages/category-page', () => ({
  CategoryPage: (props: {
    currentPage?: number;
    hubSections?: ReactElement<{ hub?: CategoryHubModel }>;
  }) =>
    categoryPageSpy({
      ...props,
      hubContent: props.hubSections?.props?.hub,
    }),
}));

vi.mock('./category-page-deferred-compare-links', () => ({
  CategoryPageDeferredCompareLinks: (props: { categorySlug: string }) => {
    mockCategoryPageDeferredCompareLinks(props);

    return <section>Maintained category compare links</section>;
  },
}));

vi.mock(
  '@/components/storefront/ogabassey/seo/commercial-support-links',
  () => ({
    CommercialSupportLinks: () => <div>CommercialSupportLinks footer</div>,
  })
);

vi.mock('@/lib/cached-data', () => ({
  getCachedCategoryPageData: vi.fn(),
  getCachedCategoryPageGraphicsOptions: vi.fn(),
  getCachedCategoryPageGraphicsOptionsStrict: vi.fn(),
  getCachedMerchant: vi.fn(),
  getCachedMerchantByDomain: vi.fn(),
  getMerchantByIdentifier: vi.fn(),
}));

vi.mock('@/lib/normalize-product', () => ({
  normalizeProduct: (product: {
    id: string;
    name: string;
    slug: string;
    description?: string | null;
    price: number;
    image: string;
    images?: string[];
    category?: string | null;
    brand?: string | null;
    condition?: string | null;
    stock?: number | null;
    product_key_specs?: Record<string, unknown> | null;
    category_slug?: string | null;
  }) => ({
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description ?? '',
    price: product.price,
    image: product.image || product.images?.[0] || NORMALIZED_PLACEHOLDER_IMAGE,
    images: product.images ?? [product.image],
    category: product.category ?? 'Smartphones',
    brand: product.brand ?? null,
    condition: product.condition ?? 'new',
    stock: product.stock ?? 0,
    product_key_specs: product.product_key_specs ?? null,
    category_slug: product.category_slug ?? 'smartphones',
  }),
}));

vi.mock('next/server', () => ({
  connection: () => mockConnection(),
}));

vi.mock('@/lib/sanitize-json-ld', () => ({
  safeJsonLdStringify: vi.fn((value: unknown) => JSON.stringify(value)),
}));

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

vi.mock('@/lib/seo-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/seo-utils')>();

  return {
    ...actual,
    generateBreadcrumbSchema: (
      ...args: Parameters<typeof mockGenerateBreadcrumbSchema>
    ) => mockGenerateBreadcrumbSchema(...args),
    generateCollectionPageSchema: (
      ...args: Parameters<typeof mockGenerateCollectionPageSchema>
    ) => mockGenerateCollectionPageSchema(...args),
    generateFAQSchema: (...args: Parameters<typeof mockGenerateFAQSchema>) =>
      mockGenerateFAQSchema(...args),
    generateMetaDescription: (description: string) =>
      description.replace(/<[^>]+>/g, '').trim(),
    getIndexableRobotsMetadata: (
      ...args: Parameters<typeof actual.getIndexableRobotsMetadata>
    ) => actual.getIndexableRobotsMetadata(...args),
  };
});

vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: (...args: unknown[]) => mockBuildStoreUrl(...args),
  buildRequestScopedStoreUrl: (...args: unknown[]) =>
    mockBuildRequestScopedStoreUrl(...args),
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

vi.mock(
  '@/lib/storefront-compare/load-compare-category-inventory-safely',
  () => ({
    loadCompareCategoryInventorySafely: async ({
      categorySlug,
    }: {
      categorySlug: string;
    }) =>
      categorySlug === 'smartphones'
        ? {
            categoryId: 'cat-1',
            categoryName: 'Smartphones',
            categorySlug: 'smartphones',
            products: smartphoneHubProducts,
          }
        : null,
  })
);

vi.mock('@/lib/storefront-category/get-cached-brand-authority-entries', () => ({
  getCachedBrandAuthorityEntries: vi.fn().mockResolvedValue([]),
}));

vi.mock('./category-page-content', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./category-page-content')>();

  return {
    ...actual,
    CategoryPageContent: (props: unknown) => mockCategoryPageContent(props),
  };
});

vi.mock('@/lib/validation', () => ({
  isDomainIdentifier: (value: string) => value.includes('.'),
}));

vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
}));

export const merchant = {
  id: 'merchant-1',
  business_name: 'Ogabassey',
  slug: 'test-store',
  custom_domain: null,
  payout_currency: 'NGN',
  site_description: 'Store description',
  logo_url: null,
};

export const categoryPageData = {
  category: {
    id: 'cat-1',
    name: 'Smartphones',
    slug: 'smartphones',
    seo_heading: null,
    seo_description: null,
    seo_features: [],
    seo_faq: [],
    image_url: null,
    parent: null,
  },
  products: smartphoneHubProducts,
  isCollection: false,
  fallbackName: 'Smartphones',
  fallbackDescription: 'Shop smartphones',
  seo: null,
  name: null,
};
