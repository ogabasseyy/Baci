import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedPdpSemanticInventory } from './get-cached-pdp-semantic-inventory';

const source = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    'get-cached-pdp-semantic-inventory.ts'
  ),
  'utf8'
);

const mocks = vi.hoisted(() => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  getCachedCompareCategoryShell: vi.fn(),
  getPublicSupabaseClient: vi.fn(),
}));

vi.mock('next/cache', () => ({
  cacheLife: (...args: unknown[]) => mocks.cacheLife(...args),
  cacheTag: (...args: unknown[]) => mocks.cacheTag(...args),
}));

vi.mock('@/lib/storefront-compare/get-cached-compare-category-shell', () => ({
  getCachedCompareCategoryShell: (...args: unknown[]) =>
    mocks.getCachedCompareCategoryShell(...args),
}));

vi.mock('@/lib/public-supabase-client', () => ({
  getPublicSupabaseClient: () => mocks.getPublicSupabaseClient(),
}));

function createProductsQuery(result: {
  data?: unknown[] | null;
  error?: unknown;
}) {
  const then = vi.fn(
    (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject)
  );
  const query = {
    abortSignal: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    limit: vi.fn(() => query),
    not: vi.fn(() => query),
    or: vi.fn(() => query),
    order: vi.fn(() => query),
    retry: vi.fn(() => query),
    select: vi.fn(() => query),
    then,
  };
  return query;
}

const categoryShell = {
  category: { name: 'Laptops' },
  fallbackName: 'Laptops',
  isCollection: false,
  productScope: {
    categoryId: 'category-1',
    categoryIds: ['category-1', 'category-2'],
    kind: 'category' as const,
  },
};

describe('getCachedPdpSemanticInventory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCachedCompareCategoryShell.mockResolvedValue(categoryShell);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the category-shared entry off the remote cache handler', () => {
    expect(source).toContain("'use cache';");
    expect(source).not.toContain("'use cache: remote';");
  });

  it('merges direct and junction category assignments with one bounded attempt each', async () => {
    const directQuery = createProductsQuery({
      data: [
        {
          brand: 'Lenovo',
          category: 'Laptops',
          category_id: 'category-1',
          condition: 'new',
          created_at: '2026-08-31T12:00:00.000Z',
          id: 'product-1',
          name: 'Lenovo Legion 5',
          price: '3,500,000',
          product_key_specs: [{ ram_gb: 32, storage_gb: 1024 }],
          slug: 'lenovo-legion-5',
          stock: 2,
          stock_quantity: null,
        },
      ],
      error: null,
    });
    const joinedQuery = createProductsQuery({
      data: [
        {
          brand: 'Asus',
          category: null,
          category_id: null,
          condition: 'new',
          created_at: '2026-08-30T12:00:00.000Z',
          id: 'product-2',
          name: 'Asus ROG',
          price: 2_000_000,
          product_categories: [
            { category_id: 'category-2', categories: { slug: 'laptops' } },
          ],
          product_key_specs: null,
          slug: 'asus-rog',
          stock: 1,
          stock_quantity: null,
        },
      ],
      error: null,
    });
    mocks.getPublicSupabaseClient.mockReturnValue({
      from: vi
        .fn()
        .mockReturnValueOnce(joinedQuery)
        .mockReturnValueOnce(directQuery),
    });

    await expect(
      getCachedPdpSemanticInventory('merchant-1', 'laptops')
    ).resolves.toEqual([
      expect.objectContaining({ slug: 'lenovo-legion-5' }),
      expect.objectContaining({ slug: 'asus-rog' }),
    ]);

    expect(mocks.getCachedCompareCategoryShell).toHaveBeenCalledWith(
      'merchant-1',
      'laptops'
    );
    expect(directQuery.in).toHaveBeenCalledWith('category_id', [
      'category-1',
      'category-2',
    ]);
    expect(joinedQuery.in).toHaveBeenCalledWith(
      'product_categories.category_id',
      ['category-1', 'category-2']
    );
    for (const query of [directQuery, joinedQuery]) {
      expect(query.limit).toHaveBeenCalledWith(48);
      expect(query.abortSignal).toHaveBeenCalledOnce();
      expect(query.retry).toHaveBeenCalledWith(false);
      expect(query.then).toHaveBeenCalledOnce();
    }
    expect(mocks.cacheLife).toHaveBeenCalledWith('products');
    expect(mocks.cacheTag).toHaveBeenCalledWith(
      'products',
      'categories',
      'products-merchant-1',
      'categories-merchant-1',
      'category-page-data-merchant-1',
      'seo-pdp-inventory-merchant-1-laptops'
    );
  });

  it('preserves the legacy category fallback without broadening the result', async () => {
    mocks.getCachedCompareCategoryShell.mockResolvedValueOnce({
      fallbackName: 'Audio',
      isCollection: false,
      productScope: { categoryName: 'Audio', kind: 'legacy' as const },
    });
    const query = createProductsQuery({ data: [], error: null });
    mocks.getPublicSupabaseClient.mockReturnValue({
      from: vi.fn(() => query),
    });

    await expect(
      getCachedPdpSemanticInventory('merchant-1', 'audio')
    ).resolves.toEqual([]);

    expect(query.or).toHaveBeenCalledWith(
      'category.ilike.%Audio%,brand.ilike.%Audio%,name.ilike.%Audio%'
    );
    expect(query.select).toHaveBeenCalledWith(
      expect.stringContaining(
        'product_categories(category_id, categories(slug))'
      )
    );
  });

  it('throws a transient query error instead of caching an empty pool', async () => {
    const joinedQuery = createProductsQuery({ data: [], error: null });
    const directQuery = createProductsQuery({
      data: null,
      error: { message: 'statement timeout' },
    });
    mocks.getPublicSupabaseClient.mockReturnValue({
      from: vi
        .fn()
        .mockReturnValueOnce(joinedQuery)
        .mockReturnValueOnce(directQuery),
    });

    await expect(
      getCachedPdpSemanticInventory('merchant-1', 'laptops')
    ).rejects.toMatchObject({ message: 'statement timeout' });
  });

  it('rejects with TimeoutError at the three-second boundary when both transports ignore abort', async () => {
    vi.useFakeTimers();
    try {
      const joinedQuery = createProductsQuery({ data: [], error: null });
      const directQuery = createProductsQuery({ data: [], error: null });
      joinedQuery.then.mockImplementation(() => new Promise(() => undefined));
      directQuery.then.mockImplementation(() => new Promise(() => undefined));
      mocks.getPublicSupabaseClient.mockReturnValue({
        from: vi
          .fn()
          .mockReturnValueOnce(joinedQuery)
          .mockReturnValueOnce(directQuery),
      });

      const pending = getCachedPdpSemanticInventory('merchant-1', 'laptops');
      const assertion = expect(pending).rejects.toMatchObject({
        name: 'TimeoutError',
      });
      await vi.advanceTimersByTimeAsync(3_001);

      await assertion;
      expect(joinedQuery.then).toHaveBeenCalledOnce();
      expect(directQuery.then).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not hit Supabase for collection or inactive scopes', async () => {
    mocks.getCachedCompareCategoryShell.mockResolvedValueOnce({
      isCollection: true,
      productScope: { collectionSlug: 'new-arrivals', kind: 'collection' },
    });
    mocks.getPublicSupabaseClient.mockReturnValue({
      from: vi.fn(),
    });

    await expect(
      getCachedPdpSemanticInventory('merchant-1', 'new-arrivals')
    ).resolves.toEqual([]);
    expect(mocks.getPublicSupabaseClient).not.toHaveBeenCalled();
  });

  it('does not create a cache key or category read for malformed categories', async () => {
    const from = vi.fn();
    mocks.getPublicSupabaseClient.mockReturnValue({ from });

    await expect(
      getCachedPdpSemanticInventory(
        'merchant-1',
        `${'category '.repeat(40)}suffix`
      )
    ).resolves.toEqual([]);

    expect(mocks.getCachedCompareCategoryShell).not.toHaveBeenCalled();
    expect(mocks.cacheLife).not.toHaveBeenCalled();
    expect(mocks.cacheTag).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
});
