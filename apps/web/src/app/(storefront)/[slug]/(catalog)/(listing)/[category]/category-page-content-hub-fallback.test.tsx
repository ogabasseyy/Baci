import { beforeEach, describe, expect, it } from 'vitest';
import {
  CategoryPageContent,
  mockBuildCategoryPageHubModel,
  mockGetCachedCategoryPageData,
  mockGetCachedCategoryPageGraphicsOptions,
  mockGetMerchantByIdentifier,
  resetCategoryPageContentMocks,
} from './category-page-content.test-utils';

describe('CategoryPageContent hub product fallback parity', () => {
  beforeEach(() => {
    resetCategoryPageContentMocks();
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Demo Store',
      slug: 'demo-store',
      country: 'NG',
      payout_currency: 'NGN',
    });
    mockGetCachedCategoryPageGraphicsOptions.mockResolvedValue([
      { value: 'rtx-4090', label: 'RTX 4090', count: 6 },
    ]);
  });

  it('fails closed to empty products for hub model when graphics-filtered page cannot load canonical pool', async () => {
    mockGetCachedCategoryPageData
      // First call for page data (filtered products)
      .mockResolvedValueOnce({
        isCollection: false,
        isInactiveCategory: false,
        category: {
          id: 'cat-1',
          name: 'Gaming Laptops',
          slug: 'gaming-laptops',
          is_active: true,
        },
        productCount: 6,
        products: [
          {
            id: 'filtered-p1',
            name: 'Filtered Laptop',
            price: 500000,
            stock: 10,
          },
        ],
        productSlots: [{ id: 'filtered-p1' }],
        productIdsQueryFailed: false,
        productsQueryFailed: false,
        categoryQueryFailed: false,
      })
      // Second call for canonical 150 hub pool throws / fails
      .mockRejectedValueOnce(new Error('Network error on canonical fetch'));

    await CategoryPageContent({
      params: Promise.resolve({
        slug: 'demo-store',
        category: 'gaming-laptops',
      }),
      searchParams: Promise.resolve({
        graphics: 'rtx-4090',
        page: '1',
      }),
    });

    expect(mockBuildCategoryPageHubModel).toHaveBeenCalledWith(
      expect.objectContaining({
        products: [],
      })
    );
  });

  it('fails closed to empty products for hub model when products query failed on unfiltered page', async () => {
    mockGetCachedCategoryPageData
      .mockResolvedValueOnce({
        isCollection: false,
        isInactiveCategory: false,
        category: {
          id: 'cat-1',
          name: 'Smartphones',
          slug: 'smartphones',
          is_active: true,
        },
        productCount: 100,
        products: [],
        productSlots: [],
        productIdsQueryFailed: false,
        productsQueryFailed: true,
        categoryQueryFailed: false,
      })
      .mockResolvedValueOnce({
        products: [],
        productsQueryFailed: true,
      });

    await CategoryPageContent({
      params: Promise.resolve({
        slug: 'demo-store',
        category: 'smartphones',
      }),
      searchParams: Promise.resolve({
        page: '1',
      }),
    });

    expect(mockBuildCategoryPageHubModel).toHaveBeenCalledWith(
      expect.objectContaining({
        products: [],
      })
    );
  });

  it('preserves filtered page products for non-hub categories', async () => {
    mockGetCachedCategoryPageData.mockResolvedValueOnce({
      isCollection: false,
      isInactiveCategory: false,
      category: {
        id: 'cat-non-hub',
        name: 'Accessories',
        slug: 'accessories',
        is_active: true,
      },
      productCount: 1,
      products: [
        {
          id: 'acc-1',
          name: 'Case',
          price: 5000,
          stock: 10,
        },
      ],
      productSlots: [{ id: 'acc-1' }],
      productIdsQueryFailed: false,
      productsQueryFailed: false,
      categoryQueryFailed: false,
    });

    await CategoryPageContent({
      params: Promise.resolve({
        slug: 'demo-store',
        category: 'accessories',
      }),
      searchParams: Promise.resolve({
        graphics: 'rtx-4090',
        page: '1',
      }),
    });

    expect(mockBuildCategoryPageHubModel).toHaveBeenCalledWith(
      expect.objectContaining({
        products: expect.arrayContaining([
          expect.objectContaining({ id: 'product-1' }),
        ]),
      })
    );
  });
});
