import { describe, expect, it, vi } from 'vitest';
import { getCachedCategoryScopedSemanticInventory } from './get-cached-category-scoped-semantic-inventory';

const mockGetCachedCategoryPageShellData = vi.fn();
const mockGetPublicSupabaseClient = vi.fn();

vi.mock('@/lib/cached-data', () => ({
  getCachedCategoryPageShellData: (...args: unknown[]) =>
    mockGetCachedCategoryPageShellData(...args),
  getPublicSupabaseClient: () => mockGetPublicSupabaseClient(),
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
    categoryIds: ['cat-laptops'],
  },
};

describe('getCachedCategoryScopedSemanticInventory manage_stock resolution', () => {
  it.each([
    {
      label: 'unmanaged with false',
      row: {
        slug: 'unmanaged-false',
        name: 'Unmanaged False',
        price: 100,
        manage_stock: false,
        stock: 0,
        stock_quantity: 0,
        product_categories: [
          { category_id: 'cat-laptops', categories: { slug: 'laptops' } },
        ],
      },
      expectedStock: null,
      expectedManageStock: false,
    },
    {
      label: 'managed with null',
      row: {
        slug: 'managed-null',
        name: 'Managed Null',
        price: 100,
        manage_stock: null,
        stock: 0,
        stock_quantity: 0,
        product_categories: [
          { category_id: 'cat-laptops', categories: { slug: 'laptops' } },
        ],
      },
      expectedStock: 0,
      expectedManageStock: null,
    },
    {
      label: 'tracked zero stock with true',
      row: {
        slug: 'tracked-zero',
        name: 'Tracked Zero',
        price: 100,
        manage_stock: true,
        stock: 0,
        stock_quantity: 0,
        product_categories: [
          { category_id: 'cat-laptops', categories: { slug: 'laptops' } },
        ],
      },
      expectedStock: 0,
      expectedManageStock: true,
    },
    {
      label: 'tracked positive stock with true',
      row: {
        slug: 'tracked-positive',
        name: 'Tracked Positive',
        price: 100,
        manage_stock: true,
        stock: 0,
        stock_quantity: 5,
        product_categories: [
          { category_id: 'cat-laptops', categories: { slug: 'laptops' } },
        ],
      },
      expectedStock: 5,
      expectedManageStock: true,
    },
    {
      label:
        'omitted manage_stock with zero stock (strict projection fallback)',
      row: {
        slug: 'omitted-zero',
        name: 'Omitted Zero',
        price: 100,
        stock: 0,
        stock_quantity: 0,
        product_categories: [
          { category_id: 'cat-laptops', categories: { slug: 'laptops' } },
        ],
      },
      expectedStock: 0,
      expectedManageStock: undefined,
    },
    {
      label: 'omitted manage_stock with positive stock',
      row: {
        slug: 'omitted-positive',
        name: 'Omitted Positive',
        price: 100,
        stock: 0,
        stock_quantity: 8,
        product_categories: [
          { category_id: 'cat-laptops', categories: { slug: 'laptops' } },
        ],
      },
      expectedStock: 8,
      expectedManageStock: undefined,
    },
    {
      label:
        'legacy positive stock with zero stock_quantity and manage_stock true',
      row: {
        slug: 'legacy-positive',
        name: 'Legacy Positive',
        price: 100,
        manage_stock: true,
        stock: 9,
        stock_quantity: 0,
        product_categories: [
          { category_id: 'cat-laptops', categories: { slug: 'laptops' } },
        ],
      },
      expectedStock: 9,
      expectedManageStock: true,
    },
  ])('resolves scoped candidate stock for $label', async ({
    row,
    expectedStock,
    expectedManageStock,
  }) => {
    const productsQuery = createProductsQuery({
      data: [row],
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
    expect(result.products[0]?.stock).toBe(expectedStock);
    expect(result.products[0]?.manage_stock).toBe(expectedManageStock);
  });
});
