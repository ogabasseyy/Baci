import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedCategoryScopedSemanticInventory } from './get-cached-category-scoped-semantic-inventory';

const mockGetPublicSupabaseClient = vi.fn();
const mockGetCachedCategoryPageShellData = vi.fn();

vi.mock('@/lib/cached-data', () => ({
  getPublicSupabaseClient: () => mockGetPublicSupabaseClient(),
  getCachedCategoryPageShellData: (...args: unknown[]) =>
    mockGetCachedCategoryPageShellData(...args),
}));

function createProductsQuery(result: {
  data?: unknown[] | null;
  error?: unknown;
}) {
  const query = {
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    or: vi.fn(() => query),
    order: vi.fn(() => query),
    select: vi.fn(() => query),
    limit: vi.fn(() => Promise.resolve(result)),
  };
  return query;
}

const categoryScopeShell = {
  isCollection: false as const,
  category: { name: 'Laptops' },
  fallbackName: 'Laptops',
  isInactiveCategory: false,
  categoryQueryFailed: false,
  productScope: {
    kind: 'category' as const,
    categoryId: 'cat-laptops',
    categoryIds: ['cat-laptops', 'cat-gaming-laptops'],
  },
};

describe('getCachedCategoryScopedSemanticInventory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('strips null/array/object spec values to match normalizeProduct compare eligibility', async () => {
    const productsQuery = createProductsQuery({
      data: [
        {
          slug: 'spec-heavy',
          name: 'Spec Heavy',
          price: 700_000,
          stock_quantity: 2,
          product_categories: [
            { category_id: 'cat-laptops', categories: { slug: 'laptops' } },
          ],
          product_key_specs: [
            {
              ram_gb: 16,
              has_5g: true,
              chipset: null,
              available_colors: ['black', 'silver'],
              recommended_for: { gaming: true },
            },
          ],
        },
      ],
      error: null,
    });
    mockGetCachedCategoryPageShellData.mockResolvedValue(categoryScopeShell);
    mockGetPublicSupabaseClient.mockReturnValue({
      from: vi.fn(() => productsQuery),
    });

    const result = await getCachedCategoryScopedSemanticInventory(
      'merchant-1',
      'laptops',
      'ogabassey'
    );

    // Only scalar spec values survive; null and array/object values are dropped.
    expect(result.products[0]?.product_key_specs).toEqual({
      ram_gb: 16,
      has_5g: true,
    });
  });

  it('keeps effective stock for a zero stock_quantity with positive legacy stock', async () => {
    const productsQuery = createProductsQuery({
      data: [
        {
          slug: 'legacy-restock',
          name: 'Legacy Restock',
          price: 500_000,
          // stock_quantity=0 but legacy stock>0: effective stock stays 8, so the
          // product is not demoted/filtered out of the SEO pool. A naive
          // `stock_quantity ?? stock` would return 0 here.
          stock: 8,
          stock_quantity: 0,
          product_categories: [
            { category_id: 'cat-laptops', categories: { slug: 'laptops' } },
          ],
        },
      ],
      error: null,
    });
    mockGetCachedCategoryPageShellData.mockResolvedValue(categoryScopeShell);
    mockGetPublicSupabaseClient.mockReturnValue({
      from: vi.fn(() => productsQuery),
    });

    const result = await getCachedCategoryScopedSemanticInventory(
      'merchant-1',
      'laptops',
      'ogabassey'
    );

    expect(result.products[0]?.stock).toBe(8);
  });

  it('falls back to the row id for a slug-less product', async () => {
    const productsQuery = createProductsQuery({
      data: [
        {
          id: 'prod-uuid-123',
          slug: null,
          name: 'Slugless Product',
          price: 120_000,
          stock_quantity: 4,
          product_categories: [
            { category_id: 'cat-laptops', categories: { slug: 'laptops' } },
          ],
        },
      ],
      error: null,
    });
    mockGetCachedCategoryPageShellData.mockResolvedValue(categoryScopeShell);
    mockGetPublicSupabaseClient.mockReturnValue({
      from: vi.fn(() => productsQuery),
    });

    const result = await getCachedCategoryScopedSemanticInventory(
      'merchant-1',
      'laptops',
      'ogabassey'
    );

    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.slug).toBe('prod-uuid-123');
  });
});
