import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedCompareCategoryInventory } from './get-cached-compare-category-inventory';

const mockGetCachedCompareCategoryShell = vi.fn();
const mockGetPublicSupabaseClient = vi.fn();

vi.mock('./get-cached-compare-category-shell', () => ({
  getCachedCompareCategoryShell: (...args: unknown[]) =>
    mockGetCachedCompareCategoryShell(...args),
}));

vi.mock('@/lib/public-supabase-client', () => ({
  getPublicSupabaseClient: () => mockGetPublicSupabaseClient(),
}));

function createProductsQuery(result: {
  data?: unknown[] | null;
  error?: unknown;
}) {
  const query = {
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    limit: vi.fn(() => Promise.resolve(result)),
    or: vi.fn(() => query),
    order: vi.fn(() => query),
    select: vi.fn(() => query),
  };
  return query;
}

describe('getCachedCompareCategoryInventory cap diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedCompareCategoryShell.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Laptops',
      productScope: {
        kind: 'category',
        categoryId: 'cat-1',
        categoryIds: ['cat-1'],
      },
    });
  });

  it('warns when the bounded inventory reaches its cap', async () => {
    const cappedRows = Array.from({ length: 600 }, (_, index) => ({
      id: `prod-${index}`,
      slug: `prod-${index}`,
      name: `Product ${index}`,
      product_categories: [{ categories: { slug: 'laptops' } }],
    }));
    const productsQuery = createProductsQuery({
      data: cappedRows,
      error: null,
    });
    mockGetPublicSupabaseClient.mockReturnValue({
      from: vi.fn(() => productsQuery),
    });
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const result = await getCachedCompareCategoryInventory(
      'merchant-1',
      'laptops'
    );

    expect(result.products).toHaveLength(600);
    expect(warnSpy).toHaveBeenCalledWith('COMPARE_INVENTORY_CAP_HIT', {
      merchantId: 'merchant-1',
      categorySlug: 'laptops',
      limit: 600,
    });
    warnSpy.mockRestore();
  });

  it('does not warn when the bounded inventory is below its cap', async () => {
    const productsQuery = createProductsQuery({
      data: [{ id: 'prod-1', slug: 'prod-1', name: 'Product 1' }],
      error: null,
    });
    mockGetPublicSupabaseClient.mockReturnValue({
      from: vi.fn(() => productsQuery),
    });
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    await getCachedCompareCategoryInventory('merchant-1', 'laptops');

    expect(warnSpy).not.toHaveBeenCalledWith(
      'COMPARE_INVENTORY_CAP_HIT',
      expect.anything()
    );
    warnSpy.mockRestore();
  });
});
