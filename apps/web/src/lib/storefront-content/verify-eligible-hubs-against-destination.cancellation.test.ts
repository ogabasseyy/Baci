import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyEligibleHubsAgainstDestination as verify } from './verify-eligible-hubs-against-destination';

const category = vi.fn();
const legacyCategory = vi.fn();
const hydrate = vi.fn();
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
vi.mock('@/lib/storefront-category/brand-authority-public-data', () => ({
  brandAuthorityPublicData: {
    getCategory: (...args: unknown[]) => legacyCategory(...args),
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
const products = Array.from({ length: 5 }, (_, i) => ({
  id: `p-${i}`,
  name: `iPhone 15 ${i}`,
  slug: `p-${i}`,
  brand: 'Apple',
  price: 100,
  stock: 2,
  manage_stock: true,
  category: 'Smartphones',
}));
const args = {
  merchantId: 'merchant-1',
  categorySlug: 'smartphones',
  hubs: {
    brandHubs: [
      { href: '/smartphones/brands/apple', label: 'Apple', brand_key: 'apple' },
    ],
    familyHubs: [
      {
        href: '/smartphones/brands/apple/families/iphone-15',
        label: 'iPhone 15',
        brand_key: 'apple',
        family_key: 'iphone-15',
      },
    ],
  },
};
const empty = { brandHubs: [], familyHubs: [] };
describe('article verification cancellation through the shared inventory reader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signal = undefined;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const name of ['select', 'eq', 'or', 'ilike', 'order'] as const)
      query[name].mockReturnValue(query);
    category.mockResolvedValue({ id: 'c-1', name: 'Smartphones' });
    legacyCategory.mockResolvedValue({ id: 'c-1', name: 'Smartphones' });
    query.range.mockResolvedValue({ data: products, count: 5, error: null });
    hydrate.mockImplementation(async (_client, _merchant, rows) => rows);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it('verifies brand and family using one bounded category/inventory operation', async () => {
    const result = await verify(args);
    expect(result.brandHubs).toHaveLength(1);
    expect(result.familyHubs).toHaveLength(1);
    expect(result.brandHubs[0].product_count).toBe(5);
    expect(query.range).toHaveBeenCalledExactlyOnceWith(0, 100);
    expect(category).toHaveBeenCalledTimes(1);
    expect(legacyCategory).not.toHaveBeenCalled();
  });
  it('aborts a stalled category and never starts a product query after it resolves late', async () => {
    vi.useFakeTimers();
    let resolveCategory: (value: unknown) => void = () => {};
    category.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCategory = resolve;
        })
    );
    const result = verify(args);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toEqual(empty);
    expect(signal?.aborted).toBe(true);
    resolveCategory({ id: 'c-1' });
    await vi.advanceTimersByTimeAsync(1);
    expect(query.range).not.toHaveBeenCalled();
  });
  it('aborts a stalled product request and prevents late hydration', async () => {
    vi.useFakeTimers();
    let resolveRows: (value: unknown) => void = () => {};
    query.range.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRows = resolve;
        })
    );
    const result = verify(args);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toEqual(empty);
    expect(signal?.aborted).toBe(true);
    resolveRows({ data: products, count: 5, error: null });
    await vi.advanceTimersByTimeAsync(1);
    expect(hydrate).not.toHaveBeenCalled();
  });
  it('aborts stalled serialized hydration with the same deadline', async () => {
    vi.useFakeTimers();
    hydrate.mockImplementationOnce(() => new Promise(() => {}));
    const result = verify(args);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toEqual(empty);
    expect(signal?.aborted).toBe(true);
  });
  it('omits both brand and family when the active category is missing', async () => {
    category.mockResolvedValueOnce(null);
    expect(await verify(args)).toEqual(empty);
    expect(query.range).not.toHaveBeenCalled();
  });
  it('does not verify or hydrate a partial oversized pool', async () => {
    query.range.mockResolvedValueOnce({
      data: products,
      count: 101,
      error: null,
    });
    expect(await verify(args)).toEqual(empty);
    expect(hydrate).not.toHaveBeenCalled();
  });
  it('omits links on query errors rather than trusting preview counts', async () => {
    query.range.mockResolvedValueOnce({
      data: null,
      error: new Error('unavailable'),
    });
    expect(await verify(args)).toEqual(empty);
  });
});
