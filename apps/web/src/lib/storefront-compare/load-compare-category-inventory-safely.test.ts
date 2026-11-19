import { describe, expect, it, vi } from 'vitest';
import { getCachedCompareCategoryInventory } from './get-cached-compare-category-inventory';
import { loadCompareCategoryInventorySafely } from './load-compare-category-inventory-safely';

vi.mock('./get-cached-compare-category-inventory', () => ({
  getCachedCompareCategoryInventory: vi.fn(),
}));

const mockGet = vi.mocked(getCachedCompareCategoryInventory);

describe('loadCompareCategoryInventorySafely', () => {
  it('returns the inventory on success', async () => {
    const inventory = { isCollection: false, products: [] };
    mockGet.mockResolvedValue(inventory as never);
    await expect(
      loadCompareCategoryInventorySafely({
        merchantId: 'merchant-1',
        categorySlug: 'smartphones',
      })
    ).resolves.toEqual(inventory);
  });

  it('returns null instead of throwing on failure', async () => {
    mockGet.mockRejectedValue(new Error('inventory unavailable'));
    await expect(
      loadCompareCategoryInventorySafely({
        merchantId: 'merchant-1',
        categorySlug: 'smartphones',
      })
    ).resolves.toBeNull();
  });
});
