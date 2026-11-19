import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListHubs = vi.fn();
vi.mock('@/lib/storefront-category/list-eligible-authority-hubs', () => ({
  listEligibleAuthorityHubs: (...args: unknown[]) => mockListHubs(...args),
}));

const { resolveModelFamilyStaticParams } = await import(
  './model-family-static-params'
);
const { OGABASSEY_DOMAIN } = await import('@/config/ogabassey');
const { PRERENDER_PLACEHOLDER_STORE_SLUG } = await import(
  '@/app/(storefront)/[slug]/(catalog)/(pdp)/[category]/[productSlug]/product-static-params'
);

describe('resolveModelFamilyStaticParams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prerenders every eligible family under its brand hub', async () => {
    mockListHubs.mockResolvedValue([
      {
        categorySlug: 'smartphones',
        brandKey: 'apple',
        familyKeys: ['iphone-16', 'iphone-17'],
        latestUpdatedAt: null,
      },
      {
        categorySlug: 'smartphones',
        brandKey: 'itel',
        familyKeys: [],
        latestUpdatedAt: null,
      },
    ]);

    await expect(resolveModelFamilyStaticParams()).resolves.toEqual([
      {
        slug: OGABASSEY_DOMAIN,
        category: 'smartphones',
        brandSlug: 'apple',
        familySlug: 'iphone-16',
      },
      {
        slug: OGABASSEY_DOMAIN,
        category: 'smartphones',
        brandSlug: 'apple',
        familySlug: 'iphone-17',
      },
    ]);
  });

  it.each([
    [
      'brands without eligible families',
      () =>
        mockListHubs.mockResolvedValue([
          {
            categorySlug: 'smartphones',
            brandKey: 'itel',
            familyKeys: [],
            latestUpdatedAt: null,
          },
        ]),
    ],
    [
      'a failed listing',
      () => mockListHubs.mockRejectedValue(new Error('db down')),
    ],
  ])('falls back to the notFound placeholder for %s', async (_case, arrange) => {
    arrange();

    await expect(resolveModelFamilyStaticParams()).resolves.toEqual([
      {
        slug: PRERENDER_PLACEHOLDER_STORE_SLUG,
        category: 'smartphones',
        brandSlug: 'apple',
        familySlug: 'iphone-16',
      },
    ]);
  });
});
