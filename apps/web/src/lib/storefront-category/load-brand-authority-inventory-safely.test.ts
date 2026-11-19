import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpectedBrandAuthorityInventoryRejectionError } from '@/lib/storefront-category/brand-authority-inventory-rejection';
import { getCachedBrandAuthorityInventory } from '@/lib/storefront-category/get-cached-brand-authority-inventory';
import { loadBrandAuthorityInventorySafely } from './load-brand-authority-inventory-safely';

type GetCachedBrandAuthorityInventoryModule =
  typeof import('@/lib/storefront-category/get-cached-brand-authority-inventory');

vi.mock(
  '@/lib/storefront-category/get-cached-brand-authority-inventory',
  async (importOriginal) => {
    const actual =
      (await importOriginal()) as GetCachedBrandAuthorityInventoryModule;
    return {
      ...actual,
      getCachedBrandAuthorityInventory: vi.fn(),
      OPTIONAL_AUTHORITY_INVENTORY_MAX_PRODUCTS: 300,
    };
  }
);

const mockGet = vi.mocked(getCachedBrandAuthorityInventory);
const entry = { brandKey: 'apple' } as never;

describe('loadBrandAuthorityInventorySafely', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it('passes a work budget to the shared reader instead of racing a background scan', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGet.mockRejectedValueOnce(
      new DOMException('timed out', 'TimeoutError')
    );
    await expect(
      loadBrandAuthorityInventorySafely({
        merchantId: 'merchant-1',
        categorySlug: 'smartphones',
        entry,
        timeoutMs: 10,
      })
    ).resolves.toBeNull();
    expect(mockGet).toHaveBeenLastCalledWith(
      'merchant-1',
      'smartphones',
      entry,
      { maxProducts: 300, timeoutMs: 10 }
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to load brand authority inventory for hub check',
      expect.objectContaining({
        categorySlug: 'smartphones',
        merchantId: 'merchant-1',
      })
    );
    warnSpy.mockRestore();
  });

  it('returns null instead of throwing on failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGet.mockRejectedValue(new Error('scan ceiling'));
    await expect(
      loadBrandAuthorityInventorySafely({
        merchantId: 'merchant-1',
        categorySlug: 'smartphones',
        entry,
      })
    ).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('suppresses console.warn on expected fail-closed verdicts', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGet.mockRejectedValue(
      new ExpectedBrandAuthorityInventoryRejectionError(
        'Brand authority category unavailable'
      )
    );
    await expect(
      loadBrandAuthorityInventorySafely({
        merchantId: 'merchant-1',
        categorySlug: 'smartphones',
        entry,
      })
    ).resolves.toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
