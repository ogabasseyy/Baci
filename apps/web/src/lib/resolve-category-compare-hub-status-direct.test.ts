import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMaybeSingle = vi.fn();
const mockCategoriesReturns = vi.fn();
const mockGetCachedProductSemanticInventory = vi.fn();

vi.mock('@/lib/cached-data', () => ({
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
});
