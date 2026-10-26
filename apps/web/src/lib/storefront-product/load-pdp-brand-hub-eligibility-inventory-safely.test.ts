import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveEligibleCategoryHubDestinations } from '@/lib/storefront-content/eligible-hub-destinations';
import {
  type LoadPdpBrandHubEligibilityInventorySafelyInput,
  loadPdpBrandHubEligibilityInventorySafely,
} from './load-pdp-brand-hub-eligibility-inventory-safely';

const mockGetCachedBrandAuthorityProducts = vi.fn();

vi.mock(
  '@/lib/storefront-category/get-cached-brand-authority-products',
  () => ({
    getCachedBrandAuthorityProducts: (...args: unknown[]) =>
      mockGetCachedBrandAuthorityProducts(...args),
  })
);

describe('loadPdpBrandHubEligibilityInventorySafely', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array without calling DB when brand is null, empty, or whitespace', async () => {
    const inputs: LoadPdpBrandHubEligibilityInventorySafelyInput[] = [
      { merchantId: 'm-1', categorySlug: 'smartphones', productBrand: null },
      {
        merchantId: 'm-1',
        categorySlug: 'smartphones',
        productBrand: undefined,
      },
      { merchantId: 'm-1', categorySlug: 'smartphones', productBrand: '' },
      { merchantId: 'm-1', categorySlug: 'smartphones', productBrand: '   ' },
    ];

    for (const input of inputs) {
      const result = await loadPdpBrandHubEligibilityInventorySafely(input);
      expect(result).toEqual([]);
    }
    expect(mockGetCachedBrandAuthorityProducts).not.toHaveBeenCalled();
  });

  it('returns empty array without calling DB when brand is not in brandAuthorityTaxonomy for that category', async () => {
    const result = await loadPdpBrandHubEligibilityInventorySafely({
      merchantId: 'm-1',
      categorySlug: 'smartphones',
      productBrand: 'NonExistentBrand123',
    });

    expect(result).toEqual([]);
    expect(mockGetCachedBrandAuthorityProducts).not.toHaveBeenCalled();
  });

  it('normalizes raw products, filters out OutOfStock items, and preserves unmanaged zero-stock items', async () => {
    // 5 Apple products: 3 iPhone 15s (1 with manage_stock: false & stock: 0), 1 iPhone 14, 1 out of stock item
    const rawDbProducts = [
      {
        id: 'p-1',
        name: 'iPhone 15 Pro Max',
        slug: 'iphone-15-pro-max',
        brand: 'Apple',
        price: 1500000,
        stock: 5,
        manage_stock: true,
      },
      {
        id: 'p-2',
        name: 'iPhone 15 Pro',
        slug: 'iphone-15-pro',
        brand: 'Apple',
        price: 1300000,
        stock: 3,
        manage_stock: true,
      },
      {
        id: 'p-3',
        name: 'iPhone 15',
        slug: 'iphone-15',
        brand: 'Apple',
        price: 1000000,
        stock: 0,
        manage_stock: false, // unmanaged zero-stock -> InStock
      },
      {
        id: 'p-4',
        name: 'iPhone 14',
        slug: 'iphone-14',
        brand: 'Apple',
        price: 850000,
        stock: 2,
        manage_stock: true,
      },
      {
        id: 'p-5',
        name: 'iPhone 13',
        slug: 'iphone-13',
        brand: 'Apple',
        price: 700000,
        stock: 4,
        manage_stock: true,
      },
      {
        id: 'p-6',
        name: 'iPhone 12 Out of Stock',
        slug: 'iphone-12-out',
        brand: 'Apple',
        price: 500000,
        stock: 0,
        manage_stock: true, // managed zero-stock -> OutOfStock
      },
    ];

    mockGetCachedBrandAuthorityProducts.mockResolvedValueOnce(rawDbProducts);

    const result = await loadPdpBrandHubEligibilityInventorySafely({
      merchantId: 'm-1',
      categorySlug: 'smartphones',
      productBrand: 'Apple',
    });

    expect(mockGetCachedBrandAuthorityProducts).toHaveBeenCalledWith(
      'm-1',
      'smartphones',
      expect.objectContaining({ brandKey: 'apple' }),
      { limit: null }
    );

    // 5 in-stock products returned, 1 out-of-stock filtered out
    expect(result).toHaveLength(5);
    expect(result.every((p) => p.availability === 'InStock')).toBe(true);

    const unmanagedZeroStock = result.find((p) => p.slug === 'iphone-15');
    expect(unmanagedZeroStock).toBeDefined();
    expect(unmanagedZeroStock?.stock).toBe(0);
    expect(unmanagedZeroStock?.availability).toBe('InStock');

    // Feeding the result into resolveEligibleCategoryHubDestinations yields eligible Apple & iPhone 15 hubs
    const destinations = resolveEligibleCategoryHubDestinations({
      categorySlug: 'smartphones',
      products: result,
      assumeCategoryScoped: true,
    });
    expect(destinations.brandHubs).toHaveLength(1);
    expect(destinations.brandHubs[0]?.brand_key).toBe('apple');
    expect(destinations.familyHubs).toHaveLength(1);
    expect(destinations.familyHubs[0]?.family_key).toBe('iphone-15');
  });

  it('logs warning and returns empty array when getCachedBrandAuthorityProducts throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new Error('Database read failed');
    mockGetCachedBrandAuthorityProducts.mockRejectedValueOnce(error);

    const result = await loadPdpBrandHubEligibilityInventorySafely({
      merchantId: 'm-1',
      categorySlug: 'smartphones',
      productBrand: 'Apple',
    });

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to load PDP brand hub eligibility inventory',
      {
        merchantId: 'm-1',
        categorySlug: 'smartphones',
        productBrand: 'Apple',
        error,
      }
    );

    warnSpy.mockRestore();
  });

  it('fails closed to empty array when getCachedBrandAuthorityProducts exceeds timeoutMs', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetCachedBrandAuthorityProducts.mockImplementationOnce(
      () => new Promise(() => {})
    );

    const result = await loadPdpBrandHubEligibilityInventorySafely({
      merchantId: 'm-1',
      categorySlug: 'smartphones',
      productBrand: 'Apple',
      timeoutMs: 10,
    });

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to load PDP brand hub eligibility inventory',
      expect.objectContaining({
        merchantId: 'm-1',
        categorySlug: 'smartphones',
        productBrand: 'Apple',
      })
    );

    warnSpy.mockRestore();
  });
});
