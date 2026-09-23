import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CategoryPageContent,
  mockGetCachedCategoryPageData,
  mockGetMerchantByIdentifier,
  mockNormalizeCategoryPageProducts,
  resetCategoryPageContentMocks,
} from './category-page-content.test-utils';

describe('CategoryPageContent pagination', () => {
  beforeEach(() => {
    resetCategoryPageContentMocks();
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
