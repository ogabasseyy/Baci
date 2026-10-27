import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { brandAuthorityTaxonomy } from './brand-authority-taxonomy';
import { getCachedBrandAuthorityInventory as read } from './get-cached-brand-authority-inventory';

const hydrate = vi.fn();
const category = vi.fn();
let signal: AbortSignal | undefined;
const query = {
  select: vi.fn(),
  eq: vi.fn(),
  or: vi.fn(),
  ilike: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
};
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@/lib/hydrate-public-products', () => ({
  hydrateAndSanitizePublicProducts: (...args: unknown[]) => hydrate(...args),
}));
vi.mock('./brand-authority-public-data', () => ({
  brandAuthorityPublicData: {
    readCategory: (...args: unknown[]) => {
      signal = args[2] as AbortSignal;
      return category(...args);
    },
    createClient: (s?: AbortSignal) => {
      signal = s;
      return { from: () => query };
    },
  },
}));
const entry = brandAuthorityTaxonomy.getEntry('smartphones', 'apple');
if (!entry) throw new Error('Missing Apple entry');
const load = () =>
  read('merchant-1', 'smartphones', entry, {
    maxProducts: 100,
    timeoutMs: 1000,
  });
const rows = [
  {
    id: 'p-1',
    name: 'iPhone 15',
    brand: 'Apple',
    price: 100,
    stock: 3,
    manage_stock: true,
    category: 'Smartphones',
  },
];
describe('shared brand inventory work budget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signal = undefined;
    for (const method of ['select', 'eq', 'or', 'ilike', 'order'] as const)
      query[method].mockReturnValue(query);
    category.mockResolvedValue({ id: 'c-1', name: 'Smartphones' });
    query.range.mockResolvedValue({ data: rows, count: 1, error: null });
    hydrate.mockImplementation(
      async (_client, _merchantId, products) => products
    );
  });
  afterEach(() => vi.useRealTimers());
  it('bounds the query before hydration and shares destination category, stock and parent scope', async () => {
    expect((await load()).products).toEqual(rows);
    expect(query.range).toHaveBeenCalledExactlyOnceWith(0, 100);
    expect(query.select).toHaveBeenCalledWith(expect.any(String), {
      count: 'exact',
    });
    const select = query.select.mock.calls[0][0] as string;
    expect(select).not.toMatch(/description|images/);
    expect(query.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(query.eq).toHaveBeenCalledWith('status', 'active');
    expect(query.or).toHaveBeenCalledWith(
      'and(is_parent.eq.true,brand.ilike.Apple),and(parent_product_id.is.null,brand.ilike.Apple),and(is_parent.eq.true,brand.ilike.iPhone),and(parent_product_id.is.null,brand.ilike.iPhone)'
    );
    expect(signal).toBeInstanceOf(AbortSignal);
  });
  it('retains specs and update metadata promised by the shared inventory result', async () => {
    const row = {
      ...rows[0],
      updated_at: '2026-10-27T12:00:00Z',
      product_key_specs: { chipset: 'A18' },
    };
    query.range.mockResolvedValueOnce({ data: [row], count: 1, error: null });
    const result = await load();
    expect(result.latestUpdatedAt).toBe(row.updated_at);
    expect(result.products[0].product_key_specs).toEqual(row.product_key_specs);
    const select = query.select.mock.calls[0][0] as string;
    expect(select).toContain('updated_at');
    expect(select).toContain('product_key_specs (');
  });
  it.each([
    null,
    2,
    101,
  ])('rejects missing, truncated or oversized count %s without hydration', async (count) => {
    query.range.mockResolvedValueOnce({ data: rows, count, error: null });
    await expect(load()).rejects.toThrow('complete-pool budget');
    expect(hydrate).not.toHaveBeenCalled();
  });
  it('accepts a complete pool exactly at the ceiling and an empty pool', async () => {
    const products = Array.from({ length: 100 }, (_, i) => ({
      ...rows[0],
      id: `p-${i}`,
    }));
    query.range.mockResolvedValueOnce({
      data: products,
      count: 100,
      error: null,
    });
    expect((await load()).products).toHaveLength(100);
    query.range.mockResolvedValueOnce({ data: [], count: 0, error: null });
    expect((await load()).products).toEqual([]);
  });
  it('does not hydrate an oversized complete pool or issue a second page', async () => {
    query.range.mockResolvedValueOnce({
      data: Array.from({ length: 101 }, () => rows[0]),
      count: 101,
      error: null,
    });
    await expect(load()).rejects.toThrow('complete-pool budget');
    expect(query.range).toHaveBeenCalledTimes(1);
    expect(hydrate).not.toHaveBeenCalled();
  });
  it('retains join and legacy membership and post-hydration serialized availability', async () => {
    const join = {
      ...rows[0],
      id: 'join',
      category: null,
      product_categories: [{ categories: { slug: 'smartphones' } }],
    };
    const wrong = { ...rows[0], id: 'wrong', category: 'Laptops' };
    query.range.mockResolvedValueOnce({
      data: [rows[0], join, wrong],
      count: 3,
      error: null,
    });
    hydrate.mockImplementationOnce(async (_client, _merchant, products) =>
      products.map((row: (typeof rows)[number]) => ({ ...row, stock: 0 }))
    );
    expect((await load()).products).toEqual([]);
    expect(
      hydrate.mock.calls[0][2].map((row: (typeof rows)[number]) => row.id)
    ).toEqual(['p-1', 'join']);
  });
  it('does not query inventory for inactive categories', async () => {
    category.mockResolvedValueOnce(null);
    await expect(load()).rejects.toThrow('category unavailable');
    expect(query.range).not.toHaveBeenCalled();
  });
  it('aborts the total deadline and starts no late product read after category resolution', async () => {
    vi.useFakeTimers();
    let resolveCategory: (value: unknown) => void = () => {};
    category.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCategory = resolve;
        })
    );
    const result = expect(load()).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(1000);
    await result;
    expect(signal?.aborted).toBe(true);
    resolveCategory({ id: 'c-1' });
    await vi.advanceTimersByTimeAsync(1);
    expect(query.range).not.toHaveBeenCalled();
  });
  it('aborts during product fetch and prevents late hydration', async () => {
    vi.useFakeTimers();
    let resolveRows: (value: unknown) => void = () => {};
    query.range.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRows = resolve;
        })
    );
    const result = expect(load()).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(1000);
    await result;
    expect(signal?.aborted).toBe(true);
    resolveRows({ data: rows, count: 1, error: null });
    await vi.advanceTimersByTimeAsync(1);
    expect(hydrate).not.toHaveBeenCalled();
  });
  it('aborts hydration with the same client signal and rejects late results', async () => {
    vi.useFakeTimers();
    hydrate.mockImplementationOnce(() => new Promise(() => {}));
    const result = expect(load()).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(1000);
    await result;
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(true);
  });
  it('propagates database errors without returning a partial pool', async () => {
    query.range.mockResolvedValueOnce({
      data: null,
      error: new Error('db error'),
    });
    await expect(load()).rejects.toThrow('db error');
    expect(hydrate).not.toHaveBeenCalled();
  });
});
