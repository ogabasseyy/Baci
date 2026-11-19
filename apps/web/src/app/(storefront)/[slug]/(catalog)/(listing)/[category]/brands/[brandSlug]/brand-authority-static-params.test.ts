import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListHubs = vi.fn();
vi.mock('@/lib/storefront-category/list-eligible-authority-hubs', () => ({
  listEligibleAuthorityHubs: (...args: unknown[]) => mockListHubs(...args),
}));

const { resolveBrandAuthorityStaticParams } = await import(
  './brand-authority-static-params'
);
const { OGABASSEY_DOMAIN, OGABASSEY_MERCHANT_ID } = await import(
  '@/config/ogabassey'
);
const { PRERENDER_PLACEHOLDER_STORE_SLUG } = await import(
  '@/app/(storefront)/[slug]/(catalog)/(pdp)/[category]/[productSlug]/product-static-params'
);

describe('resolveBrandAuthorityStaticParams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prerenders every eligible OgaBassey brand hub on the canonical domain', async () => {
    mockListHubs.mockResolvedValue([
      {
        categorySlug: 'smartphones',
        brandKey: 'apple',
        familyKeys: ['iphone-16'],
        latestUpdatedAt: null,
      },
      {
        categorySlug: 'smartphones',
        brandKey: 'samsung',
        familyKeys: [],
        latestUpdatedAt: null,
      },
    ]);

    await expect(resolveBrandAuthorityStaticParams()).resolves.toEqual([
      { slug: OGABASSEY_DOMAIN, category: 'smartphones', brandSlug: 'apple' },
      { slug: OGABASSEY_DOMAIN, category: 'smartphones', brandSlug: 'samsung' },
    ]);
    expect(mockListHubs).toHaveBeenCalledWith(OGABASSEY_MERCHANT_ID);
  });

  it.each([
    ['no eligible hubs', () => mockListHubs.mockResolvedValue([])],
    [
      'a failed listing',
      () => mockListHubs.mockRejectedValue(new Error('db down')),
    ],
  ])('falls back to the notFound placeholder for %s', async (_case, arrange) => {
    arrange();

    await expect(resolveBrandAuthorityStaticParams()).resolves.toEqual([
      {
        slug: PRERENDER_PLACEHOLDER_STORE_SLUG,
        category: 'smartphones',
        brandSlug: 'apple',
      },
    ]);
  });
});
