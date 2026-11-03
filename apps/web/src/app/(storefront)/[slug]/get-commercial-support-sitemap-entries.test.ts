import { describe, expect, it } from 'vitest';
import { getCommercialSupportSitemapEntries } from './get-commercial-support-sitemap-entries';
import type { StorefrontSitemapContext } from './sitemap-data';
import {
  createEq,
  mockBuildCommercialSupportDiscoveryLinks,
  mockCategoriesQuery,
  mockGetCachedCategoryPageData,
  registerSitemapDataTests,
} from './sitemap-data.test-setup';

describe('getCommercialSupportSitemapEntries', () => {
  registerSitemapDataTests();

  it('threads merchantCurrency into buildCommercialSupportDiscoveryLinks', async () => {
    mockCategoriesQuery([{ slug: 'gaming-laptops', updated_at: null }]);
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Gaming Laptops',
      products: [],
    });
    mockBuildCommercialSupportDiscoveryLinks.mockReturnValue([
      {
        href: 'https://ogabassey.com/gaming-laptops/best-under/under-1-5m',
        label: 'Best Under ₦1,500,000',
      },
    ]);

    const entries = await getCommercialSupportSitemapEntries({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        is_published: true,
        payout_currency: 'NGN',
      },
      storeUrl: 'https://ogabassey.com',
      supabase: {
        from: (table: string) => ({
          select: () => ({ eq: createEq(table) }),
        }),
      },
    } as unknown as StorefrontSitemapContext);

    expect(mockBuildCommercialSupportDiscoveryLinks).toHaveBeenCalledWith(
      expect.objectContaining({
        categorySlug: 'gaming-laptops',
        merchantCurrency: 'NGN',
      })
    );
    expect(entries).toEqual([
      expect.objectContaining({
        url: 'https://ogabassey.com/gaming-laptops/best-under/under-1-5m',
      }),
    ]);
  });
});
