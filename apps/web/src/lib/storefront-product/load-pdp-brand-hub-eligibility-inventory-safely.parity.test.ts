import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveEligibleCategoryHubDestinations } from '@/lib/storefront-content/eligible-hub-destinations';
import { loadPdpBrandHubEligibilityInventorySafely } from './load-pdp-brand-hub-eligibility-inventory-safely';

const mockGetInventory = vi.fn();

vi.mock(
  '@/lib/storefront-category/get-cached-brand-authority-inventory',
  () => ({
    getCachedBrandAuthorityInventory: async (...args: unknown[]) => ({
      products: await mockGetInventory(...args),
    }),
    OPTIONAL_AUTHORITY_INVENTORY_MAX_PRODUCTS: 100,
  })
);

describe('loadPdpBrandHubEligibilityInventorySafely parity fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('carries raw parity fields so resolver guards exclude variant rows', async () => {
    const parent = (id: string, name: string) => ({
      id,
      name,
      slug: id,
      brand: 'Apple',
      price: 100,
      stock: 5,
      stock_quantity: 5,
      manage_stock: true,
      is_parent: true,
      parent_product_id: null,
    });
    mockGetInventory.mockResolvedValueOnce([
      parent('p-1', 'iPhone 15 A'),
      parent('p-2', 'iPhone 15 B'),
      parent('p-3', 'iPhone 15 C'),
      parent('p-4', 'iPhone 15 D'),
      {
        ...parent('p-5', 'iPhone 15 Variant'),
        is_parent: false,
        parent_product_id: 'p-1',
      },
    ]);

    const result = await loadPdpBrandHubEligibilityInventorySafely({
      merchantId: 'm-1',
      categorySlug: 'smartphones',
      productBrand: 'Apple',
    });

    expect(result).toHaveLength(5);
    expect(result.find((p) => p.slug === 'p-5')).toMatchObject({
      manage_stock: true,
      stock_quantity: 5,
      is_parent: false,
      parent_product_id: 'p-1',
    });
    // Only 4 parent/standalone rows: below the >=5 hub threshold.
    const destinations = resolveEligibleCategoryHubDestinations({
      categorySlug: 'smartphones',
      products: result,
      assumeCategoryScoped: true,
    });
    expect(destinations.brandHubs).toHaveLength(0);
  });
});
