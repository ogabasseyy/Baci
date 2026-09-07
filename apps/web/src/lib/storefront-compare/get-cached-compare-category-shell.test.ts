import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedCompareCategoryShell } from './get-cached-compare-category-shell';

const mockCacheLife = vi.fn();
const mockCacheTag = vi.fn();
const mockGetPublicSupabaseClient = vi.fn();

vi.mock('next/cache', () => ({
  cacheLife: (...args: string[]) => mockCacheLife(...args),
  cacheTag: (...args: string[]) => mockCacheTag(...args),
}));

vi.mock('@/lib/public-supabase-client', () => ({
  getPublicSupabaseClient: () => mockGetPublicSupabaseClient(),
}));

function createCategoryQuery(result: { data?: unknown; error?: unknown }) {
  const then = vi.fn(
    (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject)
  );
  const query = {
    abortSignal: vi.fn(() => query),
    eq: vi.fn(() => query),
    or: vi.fn(() => query),
    retry: vi.fn(() => query),
    select: vi.fn(() => query),
    single: vi.fn(() => query),
    then,
  };
  return query;
}

describe('getCachedCompareCategoryShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns collection scope without querying Supabase', async () => {
    const from = vi.fn();
    mockGetPublicSupabaseClient.mockReturnValue({ from });

    await expect(
      getCachedCompareCategoryShell('merchant-1', 'new-arrivals')
    ).resolves.toEqual({
      fallbackName: 'New Arrivals',
      isCollection: true,
      productScope: { kind: 'collection', collectionSlug: 'new-arrivals' },
    });
    expect(from).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith('products');
  });

  it('returns active category scope including active descendants', async () => {
    const categoryQuery = createCategoryQuery({
      data: { id: 'cat-1', is_active: true, name: 'Laptops' },
      error: null,
    });
    const categoryScopeQuery = createCategoryQuery({
      data: [{ id: 'cat-1' }, { id: 'cat-2' }],
      error: null,
    });
    mockGetPublicSupabaseClient.mockReturnValue({
      from: vi
        .fn()
        .mockReturnValueOnce(categoryQuery)
        .mockReturnValueOnce(categoryScopeQuery),
    });

    await expect(
      getCachedCompareCategoryShell('merchant-1', 'laptops')
    ).resolves.toEqual({
      fallbackName: 'Laptops',
      isCollection: false,
      productScope: {
        kind: 'category',
        categoryId: 'cat-1',
        categoryIds: ['cat-1', 'cat-2'],
      },
    });
    for (const query of [categoryQuery, categoryScopeQuery]) {
      expect(query.abortSignal).toHaveBeenCalledOnce();
      expect(query.retry).toHaveBeenCalledWith(false);
      expect(query.then).toHaveBeenCalledOnce();
    }
  });

  it('uses legacy scope for a missing category and honors hidden slug state', async () => {
    const missingCategoryQuery = createCategoryQuery({
      data: null,
      error: { code: 'PGRST116' },
    });
    const visibleRpcQuery = createCategoryQuery({ data: [], error: null });
    const hiddenRpcQuery = createCategoryQuery({
      data: [{ is_active: false }],
      error: null,
    });
    const rpc = vi
      .fn()
      .mockReturnValueOnce(visibleRpcQuery)
      .mockReturnValueOnce(hiddenRpcQuery);
    mockGetPublicSupabaseClient.mockReturnValue({
      from: vi.fn(() => missingCategoryQuery),
      rpc,
    });

    await expect(
      getCachedCompareCategoryShell('merchant-1', 'retro-consoles')
    ).resolves.toEqual({
      fallbackName: 'Retro Consoles',
      isCollection: false,
      productScope: { kind: 'legacy', categoryName: 'Retro Consoles' },
    });
    expect(rpc).toHaveBeenCalledWith('get_storefront_category_slug_state', {
      p_merchant_id: 'merchant-1',
      p_slug: 'retro-consoles',
    });

    await expect(
      getCachedCompareCategoryShell('merchant-1', 'hidden')
    ).resolves.toMatchObject({
      productScope: { kind: 'none' },
    });
    expect(visibleRpcQuery.abortSignal).toHaveBeenCalledOnce();
    expect(visibleRpcQuery.retry).toHaveBeenCalledWith(false);
    expect(hiddenRpcQuery.abortSignal).toHaveBeenCalledOnce();
    expect(hiddenRpcQuery.retry).toHaveBeenCalledWith(false);
  });

  it('bugfix: uses shared Unicode-aware fallback names for legacy compare shells', async () => {
    const missingCategoryQuery = createCategoryQuery({
      data: null,
      error: { code: 'PGRST116' },
    });
    const visibleRpcQuery = createCategoryQuery({ data: [], error: null });
    mockGetPublicSupabaseClient.mockReturnValue({
      from: vi.fn(() => missingCategoryQuery),
      rpc: vi.fn(() => visibleRpcQuery),
    });

    await expect(
      getCachedCompareCategoryShell('merchant-1', 'électronique')
    ).resolves.toEqual({
      fallbackName: 'Électronique',
      isCollection: false,
      productScope: { kind: 'legacy', categoryName: 'Électronique' },
    });
  });

  it('rejects at three seconds when the category transport ignores abort', async () => {
    vi.useFakeTimers();
    const categoryQuery = createCategoryQuery({ data: null, error: null });
    categoryQuery.then.mockImplementation(() => new Promise(() => undefined));
    mockGetPublicSupabaseClient.mockReturnValue({
      from: vi.fn(() => categoryQuery),
    });

    const pending = getCachedCompareCategoryShell('merchant-1', 'laptops');
    const assertion = expect(pending).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    await vi.advanceTimersByTimeAsync(3_001);

    await assertion;
    expect(categoryQuery.abortSignal).toHaveBeenCalledOnce();
    expect(categoryQuery.retry).toHaveBeenCalledWith(false);
    expect(categoryQuery.then).toHaveBeenCalledOnce();
  });
});
