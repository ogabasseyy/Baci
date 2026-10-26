import { describe, expect, it, vi } from 'vitest';
import { getCachedBrandAuthorityInventory } from '@/lib/storefront-category/get-cached-brand-authority-inventory';
import { loadBrandAuthorityInventorySafely } from './load-brand-authority-inventory-safely';

vi.mock(
  '@/lib/storefront-category/get-cached-brand-authority-inventory',
  () => ({ getCachedBrandAuthorityInventory: vi.fn() })
);

const mockGet = vi.mocked(getCachedBrandAuthorityInventory);
const entry = { brandKey: 'apple' } as never;

describe('loadBrandAuthorityInventorySafely', () => {
  it('returns the destination inventory on success', async () => {
    const inventory = {
      latestUpdatedAt: null,
      productCount: 5,
      productCountIsLowerBound: false,
      products: [],
    };
    mockGet.mockResolvedValue(inventory as never);
    await expect(
      loadBrandAuthorityInventorySafely({
        merchantId: 'merchant-1',
        categorySlug: 'smartphones',
        entry,
      })
    ).resolves.toEqual(inventory);
  });

  it('returns null instead of throwing on failure', async () => {
    mockGet.mockRejectedValue(new Error('scan ceiling'));
    await expect(
      loadBrandAuthorityInventorySafely({
        merchantId: 'merchant-1',
        categorySlug: 'smartphones',
        entry,
      })
    ).resolves.toBeNull();
  });
});
