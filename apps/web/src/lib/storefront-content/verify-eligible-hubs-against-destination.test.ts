import { describe, expect, it, vi } from 'vitest';
import { loadBrandAuthorityInventorySafely } from '@/lib/storefront-category/load-brand-authority-inventory-safely';
import { verifyEligibleHubsAgainstDestination } from './verify-eligible-hubs-against-destination';

vi.mock(
  '@/lib/storefront-category/load-brand-authority-inventory-safely',
  () => ({ loadBrandAuthorityInventorySafely: vi.fn() })
);

vi.mock('@/lib/storefront-category/brand-authority-public-data', () => ({
  brandAuthorityPublicData: {
    getCategory: vi
      .fn()
      .mockResolvedValue({ id: 'cat-1', name: 'Smartphones' }),
  },
}));

const mockLoad = vi.mocked(loadBrandAuthorityInventorySafely);

const hubs = {
  brandHubs: [
    {
      href: 'https://store.test/smartphones/brands/apple',
      label: 'Explore Apple',
      brand_key: 'apple',
    },
  ],
  familyHubs: [
    {
      href: 'https://store.test/smartphones/brands/apple/families/iphone-15',
      label: 'Explore iPhone 15',
      brand_key: 'apple',
      family_key: 'iphone-15',
    },
  ],
};

describe('verifyEligibleHubsAgainstDestination', () => {
  it('keeps hubs the destination inventory confirms', async () => {
    mockLoad.mockResolvedValue({
      latestUpdatedAt: null,
      productCount: 5,
      productCountIsLowerBound: false,
      products: [
        { name: 'iPhone 15 Pro Max' },
        { name: 'iPhone 15 Pro' },
        { name: 'iPhone 15' },
        { name: 'iPhone 14' },
        { name: 'iPhone 13' },
      ] as never,
    });
    const result = await verifyEligibleHubsAgainstDestination({
      merchantId: 'merchant-1',
      categorySlug: 'smartphones',
      hubs,
    });
    expect(result.brandHubs).toHaveLength(1);
    expect(result.familyHubs).toHaveLength(1);
  });

  it('drops hubs when hydrated destination inventory is below minimum', async () => {
    mockLoad.mockResolvedValue({
      latestUpdatedAt: null,
      productCount: 2,
      productCountIsLowerBound: false,
      products: [{ name: 'iPhone 15' }, { name: 'iPhone 14' }] as never,
    });
    const result = await verifyEligibleHubsAgainstDestination({
      merchantId: 'merchant-1',
      categorySlug: 'smartphones',
      hubs,
    });
    expect(result.brandHubs).toHaveLength(0);
    expect(result.familyHubs).toHaveLength(0);
  });

  it('drops hubs when destination inventory is unavailable', async () => {
    mockLoad.mockResolvedValue(null);
    const result = await verifyEligibleHubsAgainstDestination({
      merchantId: 'merchant-1',
      categorySlug: 'smartphones',
      hubs,
    });
    expect(result.brandHubs).toHaveLength(0);
    expect(result.familyHubs).toHaveLength(0);
  });
});
