import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReadStorefrontMerchantSnapshot = vi.fn();
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

vi.mock('@/lib/storefront-merchant-snapshot', () => ({
  readStorefrontMerchantSnapshot: (...args: unknown[]) =>
    mockReadStorefrontMerchantSnapshot(...args),
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
    mockReadStorefrontMerchantSnapshot.mockResolvedValue({
      status: 'found',
      value: {
        custom_domain: null,
        feature_settings: null,
        resolution_status: 'found',
        merchant_data: {
          id: 'merchant-1',
          slug: 'ogabassey',
          is_published: true,
          business_name: 'Ogabassey',
          country: 'NG',
        },
      },
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

  it('fails open when the merchant snapshot lookup errors without caching', async () => {
    mockReadStorefrontMerchantSnapshot
      .mockResolvedValueOnce({
        status: 'unavailable',
        error: {
          kind: 'timeout',
          operation: 'merchant_snapshot',
          retryable: true,
        },
      })
      .mockResolvedValueOnce({
        status: 'not_found',
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

  it('matches resolveCategoryCompareHubStatus across draft, empty-categories, and degraded fixtures', async () => {
    const draftMerchant = {
      id: 'merchant-1',
      slug: 'ogabassey',
      is_published: false,
      business_name: 'Ogabassey',
      country: 'NG',
      custom_domain: null,
    };
    mockReadStorefrontMerchantSnapshot.mockResolvedValueOnce({
      status: 'found',
      value: {
        custom_domain: null,
        feature_settings: null,
        resolution_status: 'found',
        merchant_data: draftMerchant,
      },
    });
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
    mockReadStorefrontMerchantSnapshot.mockResolvedValueOnce({
      status: 'found',
      value: {
        custom_domain: null,
        feature_settings: null,
        resolution_status: 'found',
        merchant_data: liveMerchant,
      },
    });
    mockCategoriesReturns.mockResolvedValueOnce({ data: [], error: null });
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

    mockReadStorefrontMerchantSnapshot.mockResolvedValueOnce({
      status: 'found',
      value: {
        custom_domain: null,
        feature_settings: null,
        resolution_status: 'found',
        merchant_data: liveMerchant,
      },
    });
    mockCategoriesReturns.mockResolvedValueOnce({
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
