import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHydrate = vi.fn();
const mockRange = vi.fn();
const query = Object.fromEntries(
  ['select', 'eq', 'or', 'ilike', 'order'].map((name) => [name, vi.fn()])
) as Record<string, ReturnType<typeof vi.fn>>;
for (const method of Object.values(query))
  method.mockReturnValue({ ...query, range: mockRange });
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@/lib/hydrate-public-products', () => ({
  hydrateAndSanitizePublicProducts: (...args: unknown[]) =>
    mockHydrate(...args),
}));
vi.mock('@/lib/storefront-category/brand-authority-public-data', () => ({
  brandAuthorityPublicData: {
    createClient: () => ({
      from: () => ({ ...query, range: mockRange }),
    }),
  },
}));

describe('getCachedBrandAuthorityInventory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('matches all 3 category representations and excludes non-matching products', async () => {
    const rawProducts = [
      {
        id: 'p-1',
        name: 'Phone with product_categories',
        product_categories: [
          {
            categories: { id: 'c-1', name: 'Smartphones', slug: 'smartphones' },
          },
        ],
        stock: 1,
        manage_stock: true,
        updated_at: '2026-01-01',
      },
      {
        id: 'p-2',
        name: 'Phone with category_id object',
        categories: { id: 'c-2', name: 'Smartphones', slug: 'smartphones' },
        stock: 1,
        manage_stock: true,
        updated_at: '2026-01-02',
      },
      {
        id: 'p-3',
        name: 'Phone with legacy category string',
        category: 'Smartphones',
        stock: 1,
        manage_stock: true,
        updated_at: '2026-01-03',
      },
      {
        id: 'p-4',
        name: 'Laptop in wrong category',
        category: 'Laptops',
        stock: 1,
        manage_stock: true,
        updated_at: '2026-01-04',
      },
    ];

    mockRange.mockResolvedValueOnce({ data: rawProducts, error: null });
    mockHydrate.mockImplementation(
      async (_supabase, _merchantId, products) => products
    );

    const { getCachedBrandAuthorityInventory } = await import(
      './get-cached-brand-authority-inventory'
    );
    const result = await getCachedBrandAuthorityInventory(
      'merchant-1',
      'smartphones',
      {
        brandKey: 'samsung',
        brandQueryValue: 'Samsung',
        minimumProducts: 3,
      } as never
    );

    expect(mockHydrate).toHaveBeenCalledWith(
      expect.anything(),
      'merchant-1',
      expect.arrayContaining([
        expect.objectContaining({ id: 'p-1' }),
        expect.objectContaining({ id: 'p-2' }),
        expect.objectContaining({ id: 'p-3' }),
      ])
    );
    expect(mockHydrate).not.toHaveBeenCalledWith(
      expect.anything(),
      'merchant-1',
      expect.arrayContaining([expect.objectContaining({ id: 'p-4' })])
    );
    expect(result.productCount).toBe(3);
    expect(result.productCountIsLowerBound).toBe(false);
  });

  it('exhaustively retrieves across multiple 100-row batches even after batch 1 exceeds 48 products', async () => {
    const batch1 = Array.from({ length: 100 }, (_, index) => ({
      id: `p-${index}`,
      category: 'Smartphones',
      stock: 1,
      manage_stock: true,
      updated_at: '2026-01-01',
    }));
    const batch2 = Array.from({ length: 20 }, (_, index) => ({
      id: `p-${100 + index}`,
      category: 'Smartphones',
      stock: 1,
      manage_stock: true,
      updated_at: '2026-01-01',
    }));

    mockRange
      .mockResolvedValueOnce({ data: batch1, error: null })
      .mockResolvedValueOnce({ data: batch2, error: null });
    mockHydrate.mockImplementation(
      async (_supabase, _merchantId, products) => products
    );

    const { getCachedBrandAuthorityInventory } = await import(
      './get-cached-brand-authority-inventory'
    );
    const result = await getCachedBrandAuthorityInventory(
      'merchant-1',
      'smartphones',
      {
        brandKey: 'samsung',
        brandQueryValue: 'Samsung',
        minimumProducts: 5,
      } as never
    );

    expect(mockRange).toHaveBeenCalledTimes(2);
    expect(mockRange).toHaveBeenNthCalledWith(1, 0, 99);
    expect(mockRange).toHaveBeenNthCalledWith(2, 100, 199);
    expect(result.productCount).toBe(120);
    expect(result.productCountIsLowerBound).toBe(false);
  });

  it('throws when inventory scan reaches the 20-page ceiling on a full page', async () => {
    const fullBatch = Array.from({ length: 100 }, (_, index) => ({
      id: `p-${index}`,
      category: 'Smartphones',
      stock: 1,
      manage_stock: true,
      updated_at: '2026-01-01',
    }));

    // Mock 20 full batches
    for (let i = 0; i < 20; i++) {
      mockRange.mockResolvedValueOnce({ data: fullBatch, error: null });
    }
    mockHydrate.mockImplementation(
      async (_supabase, _merchantId, products) => products
    );

    const { getCachedBrandAuthorityInventory } = await import(
      './get-cached-brand-authority-inventory'
    );

    await expect(
      getCachedBrandAuthorityInventory('merchant-1', 'smartphones', {
        brandKey: 'samsung',
        brandQueryValue: 'Samsung',
        minimumProducts: 5,
      } as never)
    ).rejects.toThrow(
      'Brand authority inventory scan exceeded maximum page ceiling'
    );

    expect(mockRange).toHaveBeenCalledTimes(20);
  });

  it('queries every curated brand alias for a combined authority hub', async () => {
    mockRange.mockResolvedValue({ data: [], error: null });
    mockHydrate.mockResolvedValue([]);
    const { getCachedBrandAuthorityInventory } = await import(
      './get-cached-brand-authority-inventory'
    );

    await getCachedBrandAuthorityInventory('merchant-1', 'smartphones', {
      brandAliases: ['Redmi'],
      brandKey: 'xiaomi',
      brandQueryValue: 'Xiaomi',
      categorySlug: 'smartphones',
      displayName: 'Xiaomi and Redmi',
      minimumProducts: 5,
    });

    expect(query.or).toHaveBeenCalledTimes(1);
    expect(query.or).toHaveBeenCalledWith(
      'and(is_parent.eq.true,brand.ilike.Xiaomi),and(parent_product_id.is.null,brand.ilike.Xiaomi),and(is_parent.eq.true,brand.ilike.Redmi),and(parent_product_id.is.null,brand.ilike.Redmi)'
    );
  });
});
