import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CategoryPageContent,
  mockBuildCategoryPageHubModel,
  mockCategoryPageDeferredCompareLinks,
  mockGenerateBreadcrumbSchema,
  mockGenerateCollectionPageSchema,
  mockGenerateFAQSchema,
  mockGetCachedBrandAuthorityEntries,
  mockGetCachedCategoryPageData,
  mockGetCachedProductSemanticInventory,
  mockGetMerchantByIdentifier,
  mockGetPublishedClusterPosts,
  mockNormalizeCategoryPageProducts,
  resetCategoryPageContentMocks,
} from './category-page-content.test-utils';

describe('CategoryPageContent', () => {
  beforeEach(() => {
    resetCategoryPageContentMocks();
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
});
