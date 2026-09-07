import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedCompareCategoryInventory } from './get-cached-compare-category-inventory';

const mockCacheLife = vi.fn();
const mockCacheTag = vi.fn();
const mockGetCachedCategoryPageShellData = vi.fn();
const mockGetPublicSupabaseClient = vi.fn();

vi.mock('next/cache', () => ({
  cacheLife: (...args: string[]) => mockCacheLife(...args),
  cacheTag: (...args: string[]) => mockCacheTag(...args),
}));

vi.mock('./get-cached-compare-category-shell', () => ({
  getCachedCompareCategoryShell: (...args: unknown[]) =>
    mockGetCachedCategoryPageShellData(...args),
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

describe('getCachedCompareCategoryInventory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches a light category-scoped projection and normalizes rows', async () => {
    mockGetCachedCategoryPageShellData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Laptops',
      productScope: {
        kind: 'category',
        categoryId: 'cat-1',
        categoryIds: ['cat-1', 'cat-child'],
      },
    });
    const productsQuery = createProductsQuery({
      data: [
        {
          id: 'prod-1',
          slug: 'macbook-pro',
          name: 'MacBook Pro',
          brand: 'Apple',
          price: '4500000',
          product_categories: [{ categories: { slug: 'laptops' } }],
          product_key_specs: [{ ram_gb: 16, storage_gb: 512 }],
        },
        {
          // Subcategory-only member: must resolve to the CHILD slug so
          // canPublishProductComparePage keeps its pages non-indexable.
          id: 'prod-2',
          slug: 'rog-ally',
          name: 'ROG Ally',
          brand: 'Asus',
          price: 900_000,
          product_categories: [{ categories: { slug: 'gaming-handhelds' } }],
          product_key_specs: null,
        },
        {
          // Slug-less rows fall back to the id, mirroring normalizeProduct.
          id: 'prod-3',
          slug: null,
          name: 'Slugless product',
          brand: 'Apple',
          price: 100,
          product_categories: [{ categories: { slug: 'laptops' } }],
        },
        {
          // No joined categories at all: legacy text column drives the slug.
          id: 'prod-4',
          slug: 'old-netbook',
          name: 'Old Netbook',
          price: 50_000,
          category: 'Refurb Laptops',
        },
      ],
      error: null,
    });
    mockGetPublicSupabaseClient.mockReturnValue({
      from: vi.fn(() => productsQuery),
    });

    const result = await getCachedCompareCategoryInventory(
      'merchant-1',
      'laptops'
    );

    expect(mockGetCachedCategoryPageShellData).toHaveBeenCalledWith(
      'merchant-1',
      'laptops'
    );
    expect(productsQuery.select).toHaveBeenCalledWith(
      expect.stringContaining(
        'product_categories!inner(category_id, categories(slug))'
      )
    );
    expect(productsQuery.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(productsQuery.eq).toHaveBeenCalledWith('status', 'active');
    expect(productsQuery.in).toHaveBeenCalledWith(
      'product_categories.category_id',
      ['cat-1', 'cat-child']
    );
    expect(productsQuery.limit).toHaveBeenCalledWith(600);
    expect(result).toEqual({
      isCollection: false,
      fallbackName: 'Laptops',
      products: [
        {
          slug: 'macbook-pro',
          name: 'MacBook Pro',
          brand: 'Apple',
          price: 4_500_000,
          category_slug: 'laptops',
          status: 'active',
          product_key_specs: { ram_gb: 16, storage_gb: 512 },
        },
        {
          slug: 'rog-ally',
          name: 'ROG Ally',
          brand: 'Asus',
          price: 900_000,
          category_slug: 'gaming-handhelds',
          status: 'active',
          product_key_specs: null,
        },
        {
          slug: 'prod-3',
          name: 'Slugless product',
          brand: 'Apple',
          price: 100,
          category_slug: 'laptops',
          status: 'active',
          product_key_specs: null,
        },
        {
          slug: 'old-netbook',
          name: 'Old Netbook',
          brand: null,
          price: 50_000,
          category_slug: 'refurb-laptops',
          status: 'active',
          product_key_specs: null,
        },
      ],
    });
  });

  it('uses the legacy name-match filter when the category has no canonical row', async () => {
    mockGetCachedCategoryPageShellData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Retro Consoles',
      productScope: { kind: 'legacy', categoryName: 'Retro Consoles (NG)' },
    });
    const productsQuery = createProductsQuery({ data: [], error: null });
    mockGetPublicSupabaseClient.mockReturnValue({
      from: vi.fn(() => productsQuery),
    });

    const result = await getCachedCompareCategoryInventory(
      'merchant-1',
      'retro-consoles'
    );

    expect(productsQuery.or).toHaveBeenCalledWith(
      'category.ilike.%Retro Consoles NG%,brand.ilike.%Retro Consoles NG%,name.ilike.%Retro Consoles NG%'
    );
    expect(productsQuery.select).toHaveBeenCalledWith(
      expect.stringContaining('product_categories(categories(slug))')
    );
    expect(productsQuery.in).not.toHaveBeenCalled();
    expect(result.products).toEqual([]);
  });

  it('returns an empty collection inventory without querying products', async () => {
    mockGetCachedCategoryPageShellData.mockResolvedValue({
      isCollection: true,
      fallbackName: 'New Arrivals',
      productScope: { kind: 'collection', collectionSlug: 'new-arrivals' },
    });
    const from = vi.fn();
    mockGetPublicSupabaseClient.mockReturnValue({ from });

    const result = await getCachedCompareCategoryInventory(
      'merchant-1',
      'new-arrivals'
    );

    expect(result).toEqual({
      isCollection: true,
      fallbackName: 'New Arrivals',
      products: [],
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('returns no products for inactive categories (scope none)', async () => {
    mockGetCachedCategoryPageShellData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Hidden',
      productScope: { kind: 'none' },
    });
    const from = vi.fn();
    mockGetPublicSupabaseClient.mockReturnValue({ from });

    const result = await getCachedCompareCategoryInventory(
      'merchant-1',
      'hidden'
    );

    expect(result).toEqual({
      isCollection: false,
      fallbackName: 'Hidden',
      products: [],
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('throws on query errors so transient failures are never cached', async () => {
    mockGetCachedCategoryPageShellData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Laptops',
      productScope: {
        kind: 'category',
        categoryId: 'cat-1',
        categoryIds: ['cat-1'],
      },
    });
    const productsQuery = createProductsQuery({
      data: null,
      error: { message: 'connection reset' },
    });
    mockGetPublicSupabaseClient.mockReturnValue({
      from: vi.fn(() => productsQuery),
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(
      getCachedCompareCategoryInventory('merchant-1', 'laptops')
    ).rejects.toEqual({ message: 'connection reset' });

    consoleError.mockRestore();
  });

  it('propagates fail-loud category shell errors before querying products', async () => {
    const shellError = new Error('category scope unavailable');
    mockGetCachedCategoryPageShellData.mockRejectedValue(shellError);
    const from = vi.fn();
    mockGetPublicSupabaseClient.mockReturnValue({ from });

    await expect(
      getCachedCompareCategoryInventory('merchant-1', 'laptops')
    ).rejects.toBe(shellError);
    expect(from).not.toHaveBeenCalled();
  });
});
