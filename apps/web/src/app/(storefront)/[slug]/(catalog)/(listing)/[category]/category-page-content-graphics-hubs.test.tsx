import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CategoryPageContent,
  mockBuildCategoryPageHubModel,
  mockBuildRequestScopedStoreUrl,
  mockBuildStoreUrl,
  mockGenerateCollectionPageSchema,
  mockGetCachedCategoryPageData,
  mockGetCachedCategoryPageGraphicsOptions,
  mockGetMerchantByIdentifier,
  resetCategoryPageContentMocks,
} from './category-page-content.test-utils';

describe('CategoryPageContent graphics hubs', () => {
  beforeEach(() => {
    resetCategoryPageContentMocks();
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: 'NG',
      payout_currency: 'NGN',
    });
  });

  it('uses a curated hub name and canonical URL in collection schema', async () => {
    await CategoryPageContent({
      canonicalBaseUrl:
        'https://ogabassey.com/gaming-laptops/graphics/rtx-4070',
      params: Promise.resolve({
        slug: 'demo-store',
        category: 'gaming-laptops',
      }),
      searchParams: Promise.resolve({
        graphics: 'NVIDIA RTX 4070',
        page: '1',
      }),
      seoPageName: 'RTX 4070 Gaming Laptops',
      titleHeading: 'h2',
    });

    expect(mockGenerateCollectionPageSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'RTX 4070 Gaming Laptops',
        url: 'https://ogabassey.com/gaming-laptops/graphics/rtx-4070',
      })
    );
  });

  it('uses the curated hub URL for paginated collection schema', async () => {
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: true,
      category: null,
      productCount: 48,
      products: [{ id: 'product-1' }],
      productIdsQueryFailed: false,
      productsQueryFailed: false,
    });

    await CategoryPageContent({
      canonicalBaseUrl:
        'https://ogabassey.com/gaming-laptops/graphics/rtx-4070',
      params: Promise.resolve({
        slug: 'demo-store',
        category: 'gaming-laptops',
      }),
      searchParams: Promise.resolve({
        graphics: 'NVIDIA RTX 4070',
        page: '2',
      }),
      seoPageName: 'RTX 4070 Gaming Laptops',
      titleHeading: 'h2',
    });

    expect(mockGenerateCollectionPageSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'RTX 4070 Gaming Laptops',
        url: 'https://ogabassey.com/gaming-laptops/graphics/rtx-4070?page=2',
      })
    );
  });

  it('adds curated GPU hub links only for inventory-backed gaming ranges', async () => {
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: true,
      category: null,
      productCount: 2,
      products: [{ id: 'product-1' }],
      productIdsQueryFailed: false,
      productsQueryFailed: false,
    });
    mockGetCachedCategoryPageGraphicsOptions.mockResolvedValue([
      'NVIDIA RTX 4070 8GB',
      'RTX 5090 24GB',
    ]);

    await CategoryPageContent({
      params: Promise.resolve({
        slug: 'demo-store',
        category: 'gaming-laptops',
      }),
      searchParams: Promise.resolve({ page: '1' }),
    });

    expect(mockBuildCategoryPageHubModel).toHaveBeenCalledWith(
      expect.objectContaining({
        comparisonLinks: [
          {
            href: expect.stringMatching(
              /\/gaming-laptops\/graphics\/rtx-4070$/
            ),
            label: 'Shop RTX 4070 gaming laptops',
          },
        ],
      })
    );
  });

  it('keeps hub pagination on the request-scoped storefront path', async () => {
    mockBuildStoreUrl.mockReturnValue('http://localhost:3000/ogabassey');
    mockBuildRequestScopedStoreUrl.mockReturnValue(
      'http://localhost:3000/ogabassey'
    );

    const ui = await CategoryPageContent({
      canonicalBaseUrl:
        'http://localhost:3000/ogabassey/gaming-laptops/graphics/rtx-4070',
      params: Promise.resolve({
        slug: 'demo-store',
        category: 'gaming-laptops',
      }),
      searchParams: Promise.resolve({
        graphics: 'NVIDIA RTX 4070',
        page: '1',
      }),
      seoPageName: 'RTX 4070 Gaming Laptops',
      titleHeading: 'h2',
    });

    render(ui);

    expect(
      screen.getByText(
        'Pagination: /ogabassey/gaming-laptops/graphics/rtx-4070'
      )
    ).toBeInTheDocument();
  });

  it('passes the full trusted hub selection through without the request cap', async () => {
    const available = Array.from({ length: 10 }, (_, i) => `GPU ${i}`);
    mockGetCachedCategoryPageGraphicsOptions.mockResolvedValue(available);

    const ui = await CategoryPageContent({
      params: Promise.resolve({
        slug: 'demo-store',
        category: 'gaming-laptops',
      }),
      searchParams: Promise.resolve({ graphics: available, page: '1' }),
      trustedGraphics: true,
    });

    render(ui);

    expect(screen.getAllByText(/Selected: GPU/)).toHaveLength(10);
  });
});
