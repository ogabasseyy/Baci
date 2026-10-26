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

  it('scopes the query to the category AND its child categories by id', async () => {
    const productsQuery = createProductsQuery({
      data: [
        {
          slug: 'macbook-pro',
          name: 'MacBook Pro',
          price: '4,500,000',
          brand: 'Apple',
          condition: 'new',
          stock_quantity: 7,
          product_categories: [
            { category_id: 'cat-laptops', categories: { slug: 'laptops' } },
          ],
          product_key_specs: [{ ram_gb: 16, storage_gb: 512 }],
        },
        {
          slug: 'legion-5',
          name: 'Lenovo Legion 5',
          price: 1_200_000,
          brand: 'Lenovo',
          condition: 'new',
          stock: 3,
          // subcategory-only member: resolves to the child slug when the
          // requested category is not among its memberships
          product_categories: [
            {
              category_id: 'cat-gaming-laptops',
              categories: { slug: 'gaming-laptops' },
            },
          ],
          product_key_specs: [{ ram_gb: 32 }],
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

    expect(productsQuery.in).toHaveBeenCalledWith(
      'product_categories.category_id',
      ['cat-laptops', 'cat-gaming-laptops']
    );
    expect(result.isCollection).toBe(false);
    expect(result.categoryName).toBe('Laptops');
    expect(result.products).toEqual([
      {
        slug: 'macbook-pro',
        name: 'MacBook Pro',
        price: 4_500_000,
        brand: 'Apple',
        condition: 'new',
        stock: 7,
        category_slug: 'laptops',
        product_key_specs: { ram_gb: 16, storage_gb: 512 },
        category_slugs: ['laptops'],
        is_parent: null,
        parent_product_id: null,
      },
      {
        slug: 'legion-5',
        name: 'Lenovo Legion 5',
        price: 1_200_000,
        brand: 'Lenovo',
        condition: 'new',
        stock: 3,
        category_slug: 'gaming-laptops',
        product_key_specs: { ram_gb: 32 },
        category_slugs: ['gaming-laptops'],
        is_parent: null,
        parent_product_id: null,
      },
    ]);
  });

  it('bounds the query with the compare-page-aligned inventory limit', async () => {
    const productsQuery = createProductsQuery({ data: [], error: null });
    mockGetCachedCategoryPageShellData.mockResolvedValue(categoryScopeShell);
    mockGetPublicSupabaseClient.mockReturnValue({
      from: vi.fn(() => productsQuery),
    });

    await getCachedCategoryScopedSemanticInventory(
      'merchant-1',
      'laptops',
      'ogabassey'
    );

    // Aligned to COMPARE_CATEGORY_INVENTORY_PRODUCT_LIMIT (600) so the SEO pool
    // never exceeds what compare pages can resolve.
    expect(productsQuery.limit).toHaveBeenCalledWith(600);
  });

  it('returns an empty collection pool without querying products', async () => {
    mockGetCachedCategoryPageShellData.mockResolvedValue({
      isCollection: true,
      name: 'New Arrivals',
      description: 'Latest drops',
      fallbackName: 'New Arrivals',
    });
    const from = vi.fn();
    mockGetPublicSupabaseClient.mockReturnValue({ from });

    const result = await getCachedCategoryScopedSemanticInventory(
      'merchant-1',
      'new-arrivals',
      'ogabassey'
    );

    expect(result).toEqual({
      isCollection: true,
      categoryName: 'New Arrivals',
      products: [],
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('propagates a transient shell failure so an empty pool is never fixed', async () => {
    const shellError = Object.assign(new Error('statement timeout'), {
      code: '57014',
    });
    mockGetCachedCategoryPageShellData.mockRejectedValue(shellError);
    mockGetPublicSupabaseClient.mockReturnValue({ from: vi.fn() });

    await expect(
      getCachedCategoryScopedSemanticInventory(
        'merchant-1',
        'laptops',
        'ogabassey'
      )
    ).rejects.toBe(shellError);
  });

  it('falls back to an ilike membership filter for legacy category URLs and resolves the slug from the category column', async () => {
    const productsQuery = createProductsQuery({
      data: [
        {
          slug: 'legacy-phone',
          name: 'Legacy Phone',
          price: 90_000,
          // No category join, but a denormalized `category` value: category_slug
          // must resolve to generateSlug(category) ('retro-tech'), matching
          // normalizeProduct, NOT the requested URL slug ('vintage').
          category: 'Retro Tech',
          product_categories: [],
        },
      ],
      error: null,
    });
    mockGetCachedCategoryPageShellData.mockResolvedValue({
      isCollection: false,
      category: null,
      fallbackName: 'Vintage',
      isInactiveCategory: false,
      categoryQueryFailed: false,
      productScope: { kind: 'legacy', categoryName: 'Vintage Tech' },
    });
    mockGetPublicSupabaseClient.mockReturnValue({
      from: vi.fn(() => productsQuery),
    });

    const result = await getCachedCategoryScopedSemanticInventory(
      'merchant-1',
      'vintage',
      'ogabassey'
    );

    expect(productsQuery.or).toHaveBeenCalledWith(
      'category.ilike.%Vintage Tech%,brand.ilike.%Vintage Tech%,name.ilike.%Vintage Tech%'
    );
    expect(result.products).toEqual([
      {
        slug: 'legacy-phone',
        name: 'Legacy Phone',
        price: 90_000,
        brand: undefined,
        condition: undefined,
        // effective stock: no stock/stock_quantity -> 0
        stock: 0,
        category_slug: 'retro-tech',
        product_key_specs: null,
        category_slugs: [],
        is_parent: null,
        parent_product_id: null,
      },
    ]);
  });
});
