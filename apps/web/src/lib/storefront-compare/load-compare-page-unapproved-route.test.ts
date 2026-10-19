import { describe, expect, it, vi } from 'vitest';
import * as compareIndexabilityPolicy from '@/lib/storefront-compare/compare-indexability-policy';

const mockGetMerchantByIdentifier = vi.fn();
const mockGetCachedProductWithDetails = vi.fn();
const mockGetCachedCompareCategoryInventory = vi.fn();

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: (...args: unknown[]) =>
    mockGetMerchantByIdentifier(...args),
  getCachedProductWithDetails: (...args: unknown[]) =>
    mockGetCachedProductWithDetails(...args),
}));

vi.mock(
  '@/lib/storefront-compare/get-cached-compare-category-inventory',
  () => ({
    COMPARE_CATEGORY_INVENTORY_PRODUCT_LIMIT: 600,
    getCachedCompareCategoryInventory: (...args: unknown[]) =>
      mockGetCachedCompareCategoryInventory(...args),
  })
);

describe('loadComparePage unapproved product route', () => {
  it('does not build a second curated graph after the maintained manifest rejects an existing pair', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'Ogabassey',
      payout_currency: 'NGN',
    });
    mockGetCachedCompareCategoryInventory.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Smartphones',
      products: [
        {
          slug: 'unapproved-left',
          name: 'Unapproved Left',
          brand: 'Example',
          price: 100_000,
          category_slug: 'smartphones',
          status: 'active',
          product_key_specs: {},
        },
        {
          slug: 'unapproved-right',
          name: 'Unapproved Right',
          brand: 'Example',
          price: 110_000,
          category_slug: 'smartphones',
          status: 'active',
          product_key_specs: {},
        },
      ],
    });
    const curatedGraphSpy = vi.spyOn(
      compareIndexabilityPolicy,
      'buildCuratedCompareSlugSet'
    );
    const { loadComparePage } = await import(
      '@/lib/storefront-compare/load-compare-page'
    );

    const result = await loadComparePage({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      comparisonSlug: 'unapproved-left-vs-unapproved-right',
    });

    expect(result).toBeNull();
    expect(mockGetCachedProductWithDetails).not.toHaveBeenCalled();
    // The maintained manifest needs one curated graph. Repeating it in the
    // page model after that manifest has rejected the route is redundant.
    expect(curatedGraphSpy).toHaveBeenCalledTimes(1);
    curatedGraphSpy.mockRestore();
  });
});
