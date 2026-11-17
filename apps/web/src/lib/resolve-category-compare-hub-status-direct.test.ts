import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMaybeSingle = vi.fn();
const mockCategoriesReturns = vi.fn();
const mockGetCachedProductSemanticInventory = vi.fn();
const mockGetMerchantByIdentifier = vi.fn();
const mockGetCachedCategories = vi.fn();
const mockLoadCategoryCompareHubData = vi.fn();

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: (...args: unknown[]) =>
    mockGetMerchantByIdentifier(...args),
  getCachedCategories: (...args: unknown[]) => mockGetCachedCategories(...args),
  getPublicSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'merchants') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: mockMaybeSingle,
            }),
          }),
        };
      }
      if (table === 'categories') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                returns: mockCategoriesReturns,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  }),
}));

vi.mock('@/lib/domain-cache-simple', () => ({
  getSlugForCustomDomain: vi.fn().mockResolvedValue('ogabassey'),
}));

vi.mock(
  '@/lib/storefront-product/get-cached-product-semantic-inventory',
  () => ({
    getCachedProductSemanticInventory: (...args: unknown[]) =>
      mockGetCachedProductSemanticInventory(...args),
  })
);

vi.mock(
  '@/app/(storefront)/[slug]/(catalog)/(listing)/[category]/compare/load-category-compare-hub-data',
  () => ({
    loadCategoryCompareHubData: (...args: unknown[]) =>
      mockLoadCategoryCompareHubData(...args),
  })
);

import { resolveCategoryCompareHubStatus } from '@/app/(storefront)/[slug]/(catalog)/(listing)/[category]/compare/resolve-category-compare-hub-status';
import { resolveCategoryCompareHubStatusDirect } from './resolve-category-compare-hub-status-direct';
import {
  clearStorefrontCompareHubStatusCache,
  resolveStorefrontCompareHubStatus,
} from './storefront-compare-hub-status';

describe('resolveStorefrontCompareHubStatus direct proxy lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearStorefrontCompareHubStatusCache();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  it('resolves empty via direct Supabase lookup without use-cache directives', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: 'merchant-1',
        slug: 'ogabassey',
        is_published: true,
        business_name: 'Ogabassey',
        country: 'NG',
      },
      error: null,
    });
    mockCategoriesReturns.mockResolvedValue({
      data: [
        {
          id: 'cat-1',
          name: 'Printers',
          slug: 'printers',
          is_active: true,
          parent_id: null,
        },
      ],
      error: null,
    });
    mockGetCachedProductSemanticInventory.mockResolvedValue([]);

    const resolution = await resolveStorefrontCompareHubStatus({
      origin: 'https://ogabassey.com',
      identifier: 'ogabassey',
      categorySlug: 'printers',
      secret: 'test-secret',
    });

    expect(resolution).toEqual({ kind: 'empty' });
  });

  it('fails open when the merchant query errors without caching', async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({
        data: null,
        error: new Error('db connection timeout'),
      })
      .mockResolvedValueOnce({
        data: null,
        error: null,
      });

    await expect(
      resolveStorefrontCompareHubStatus({
        origin: 'https://ogabassey.com',
        identifier: 'ogabassey',
        categorySlug: 'printers',
        secret: 'test-secret',
      })
    ).resolves.toEqual({ kind: 'renderable-or-unknown' });

    await expect(
      resolveStorefrontCompareHubStatus({
        origin: 'https://ogabassey.com',
        identifier: 'ogabassey',
        categorySlug: 'printers',
        secret: 'test-secret',
      })
    ).resolves.toEqual({ kind: 'empty' });
  });

  it('matches resolveCategoryCompareHubStatus across draft, empty, and degraded fixtures', async () => {
    const draftMerchant = {
      id: 'merchant-1',
      slug: 'ogabassey',
      is_published: false,
      business_name: 'Ogabassey',
      country: 'NG',
    };
    mockMaybeSingle.mockResolvedValueOnce({ data: draftMerchant, error: null });
    mockGetMerchantByIdentifier.mockResolvedValueOnce(draftMerchant);
    await expect(
      resolveCategoryCompareHubStatusDirect({
        merchantSlug: 'ogabassey',
        categorySlug: 'printers',
      })
    ).resolves.toEqual(
      await resolveCategoryCompareHubStatus({
        merchantSlug: 'ogabassey',
        categorySlug: 'printers',
      })
    );

    const liveMerchant = { ...draftMerchant, is_published: true };
    mockMaybeSingle.mockResolvedValueOnce({ data: liveMerchant, error: null });
    mockCategoriesReturns.mockResolvedValueOnce([]);
    mockGetMerchantByIdentifier.mockResolvedValueOnce(liveMerchant);
    mockGetCachedCategories.mockResolvedValueOnce([]);
    await expect(
      resolveCategoryCompareHubStatusDirect({
        merchantSlug: 'ogabassey',
        categorySlug: 'printers',
      })
    ).resolves.toEqual(
      await resolveCategoryCompareHubStatus({
        merchantSlug: 'ogabassey',
        categorySlug: 'printers',
      })
    );

    mockMaybeSingle.mockResolvedValueOnce({ data: liveMerchant, error: null });
    mockCategoriesReturns.mockResolvedValueOnce([
      {
        id: 'cat-1',
        name: 'Printers',
        slug: 'printers',
        is_active: true,
        parent_id: null,
      },
    ]);
    mockGetCachedProductSemanticInventory.mockRejectedValueOnce(
      new Error('inventory degraded')
    );
    mockGetMerchantByIdentifier.mockResolvedValueOnce(liveMerchant);
    mockGetCachedCategories.mockResolvedValueOnce([
      { id: 'cat-1', name: 'Printers', slug: 'printers' },
    ]);
    mockLoadCategoryCompareHubData.mockResolvedValueOnce({
      categoryName: 'Printers',
      categorySlug: 'printers',
      merchant: liveMerchant,
      productGroups: [],
      products: [],
      inventoryDegraded: true,
      storeUrl: 'https://ogabassey.usebaci.com',
    });
    await expect(
      resolveCategoryCompareHubStatusDirect({
        merchantSlug: 'ogabassey',
        categorySlug: 'printers',
      })
    ).resolves.toEqual(
      await resolveCategoryCompareHubStatus({
        merchantSlug: 'ogabassey',
        categorySlug: 'printers',
      })
    );
  });
});
