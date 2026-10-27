import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublicSupabaseClient } from '@/lib/public-supabase-client';
import { getCachedCompareCategoryShell } from '@/lib/storefront-compare/get-cached-compare-category-shell';
import { getCachedPriceBandDestinationProjection } from './get-cached-price-band-destination-projection';

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@/lib/public-supabase-client', () => ({
  getPublicSupabaseClient: vi.fn(),
}));
vi.mock('@/lib/storefront-compare/get-cached-compare-category-shell', () => ({
  getCachedCompareCategoryShell: vi.fn(),
}));

const row = {
  id: 'p1',
  name: 'Phone',
  slug: 'phone',
  brand: 'Apple',
  price: 500000,
};
const execute = vi.fn();
const query = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  abortSignal: vi.fn().mockReturnThis(),
  retry: execute,
};
const from = vi.fn().mockReturnValue(query);

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue({ data: [row], count: 1, error: null });
  vi.mocked(getPublicSupabaseClient).mockReturnValue({
    from,
  } as unknown as ReturnType<typeof getPublicSupabaseClient>);
  vi.mocked(getCachedCompareCategoryShell).mockResolvedValue({
    isCollection: false,
    fallbackName: 'Smartphones',
    productScope: {
      kind: 'category',
      categoryId: 'cat',
      categoryIds: ['cat', 'child'],
    },
  });
});
afterEach(() => vi.useRealTimers());

describe('bounded price-band destination projection', () => {
  it('reads only candidate fields under the destination merchant/category/active scope', async () => {
    expect(
      await getCachedPriceBandDestinationProjection('m1', 'smartphones')
    ).toEqual([
      { slug: 'phone', name: 'Phone', brand: 'Apple', price: 500000 },
    ]);
    expect(query.select).toHaveBeenCalledWith(
      'id, slug, name, brand, price, product_categories!inner(category_id)',
      { count: 'exact' }
    );
    expect(query.eq).toHaveBeenCalledWith('merchant_id', 'm1');
    expect(query.eq).toHaveBeenCalledWith('status', 'active');
    expect(query.in).toHaveBeenCalledWith('product_categories.category_id', [
      'cat',
      'child',
    ]);
    expect(query.limit).toHaveBeenCalledWith(601);
    expect(query.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(execute).toHaveBeenCalledWith(false);
  });

  it.each([
    601,
    null,
    2,
  ])('fails closed when count %s cannot prove the returned pool complete', async (count) => {
    execute.mockResolvedValue({ data: [row], count, error: null });
    expect(
      await getCachedPriceBandDestinationProjection('m1', 'smartphones')
    ).toBeNull();
  });

  it('retains unavailable rows and slug fallback without fetching stock or product detail', async () => {
    execute.mockResolvedValue({
      data: [{ ...row, slug: null, price: '500000', stock: 0 }],
      count: 1,
      error: null,
    });
    expect(
      await getCachedPriceBandDestinationProjection('m1', 'smartphones')
    ).toEqual([{ slug: 'p1', name: 'Phone', brand: 'Apple', price: 500000 }]);
  });

  it('uses the same legacy membership predicate without extra catalogue reads', async () => {
    vi.mocked(getCachedCompareCategoryShell).mockResolvedValue({
      isCollection: false,
      fallbackName: 'Phones',
      productScope: { kind: 'legacy', categoryName: 'Phones' },
    });
    await getCachedPriceBandDestinationProjection('m1', 'phones');
    expect(query.or).toHaveBeenCalledWith(
      'category.ilike.%Phones%,brand.ilike.%Phones%,name.ilike.%Phones%'
    );
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('aborts the real projection request when its deadline expires', async () => {
    vi.useFakeTimers();
    execute.mockImplementation(() => new Promise(() => {}));
    const result = getCachedPriceBandDestinationProjection('m1', 'smartphones');
    const assertion = expect(result).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
    const signal = query.abortSignal.mock.calls[0]?.[0] as AbortSignal;
    expect(signal.aborted).toBe(true);
  });
  it('rejects an otherwise complete over-cap catalogue', async () => {
    execute.mockResolvedValue({
      data: Array.from({ length: 601 }, (_, i) => ({ ...row, id: `p${i}` })),
      count: 601,
      error: null,
    });
    expect(
      await getCachedPriceBandDestinationProjection('m1', 'smartphones')
    ).toBeNull();
  });

  it.each([
    'collection',
    'none',
  ] as const)('does not fetch products for %s scopes', async (kind) => {
    vi.mocked(getCachedCompareCategoryShell).mockResolvedValue({
      isCollection: kind === 'collection',
      fallbackName: 'None',
      productScope:
        kind === 'collection' ? { kind, collectionSlug: 'featured' } : { kind },
    });
    expect(
      await getCachedPriceBandDestinationProjection('m1', 'smartphones')
    ).toEqual(kind === 'collection' ? null : []);
    expect(from).not.toHaveBeenCalled();
  });

  it('propagates query errors so the optional wrapper can fail closed without caching a success', async () => {
    const error = new Error('database unavailable');
    execute.mockResolvedValue({ data: null, count: null, error });
    await expect(
      getCachedPriceBandDestinationProjection('m1', 'smartphones')
    ).rejects.toBe(error);
  });

  it('never starts a projection after the shell has exhausted the total deadline', async () => {
    vi.useFakeTimers();
    vi.mocked(getCachedCompareCategoryShell).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                isCollection: false,
                fallbackName: 'Phones',
                productScope: { kind: 'legacy', categoryName: 'Phones' },
              }),
            5000
          );
        })
    );
    const assertion = expect(
      getCachedPriceBandDestinationProjection('m1', 'phones')
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
    await vi.advanceTimersByTimeAsync(5000);
    expect(from).not.toHaveBeenCalled();
  });
});
