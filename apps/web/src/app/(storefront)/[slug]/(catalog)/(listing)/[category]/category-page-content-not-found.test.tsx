import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CategoryPageContent,
  mockGenerateCollectionPageSchema,
  mockGetCachedCategoryPageData,
  mockGetMerchantByIdentifier,
  resetCategoryPageContentMocks,
} from './category-page-content.test-utils';

describe('CategoryPageContent not-found', () => {
  beforeEach(() => {
    resetCategoryPageContentMocks();
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
});
