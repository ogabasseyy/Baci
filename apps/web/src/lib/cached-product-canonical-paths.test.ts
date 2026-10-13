import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCacheTag, mockCreatePublicClient } = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockCreatePublicClient: vi.fn(),
}));

vi.mock('next/cache', () => ({
  cacheLife: vi.fn(),
  cacheTag: (...args: unknown[]) => mockCacheTag(...args),
}));
vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: (...args: unknown[]) => mockCreatePublicClient(...args),
}));
vi.mock('@/lib/seo-utils', () => ({
  // Mirrors the real fallback chain: joined category slug, then slugified
  // legacy category text, then the uncategorized /products prefix.
  getProductUrl: (product: {
    slug?: string;
    category?: string | null;
    categories?: { slug?: string } | null;
  }) =>
    `/${
      product.categories?.slug ?? product.category?.toLowerCase() ?? 'products'
    }/${product.slug}`,
}));

import { getCachedProductCanonicalPaths } from './cached-product-canonical-paths';

function createQueryBuilder(result: {
  data?: unknown[] | null;
  error?: { message: string } | null;
}) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    in: vi.fn(() =>
      Promise.resolve({
        data: result.data ?? null,
        error: result.error ?? null,
      })
    ),
  };

  return builder;
}

describe('getCachedProductCanonicalPaths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps active product slugs to their canonical category paths', async () => {
    const builder = createQueryBuilder({
      data: [
        {
          id: 'p1',
          name: 'iPhone XR',
          slug: 'iphone-xr',
          category: 'Smartphones',
          categories: { name: 'Smartphones', slug: 'smartphones' },
        },
        {
          id: 'p2',
          name: 'AirPods 2',
          slug: 'apple-airpods-2',
          category: 'Earbuds',
          categories: { name: 'Earbuds', slug: 'earbuds' },
        },
      ],
    });
    mockCreatePublicClient.mockReturnValue({ from: vi.fn(() => builder) });

    const paths = await getCachedProductCanonicalPaths('merchant-1', [
      'iphone-xr',
      'apple-airpods-2',
      'archived-slug',
    ]);

    expect(paths).toEqual({
      'iphone-xr': '/smartphones/iphone-xr',
      'apple-airpods-2': '/earbuds/apple-airpods-2',
    });
    expect(builder.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(builder.eq).toHaveBeenCalledWith('status', 'active');
    expect(builder.in).toHaveBeenCalledWith('slug', [
      'iphone-xr',
      'apple-airpods-2',
      'archived-slug',
    ]);
  });

  it('registers product and category revalidation tags for the merchant', async () => {
    const builder = createQueryBuilder({ data: [] });
    mockCreatePublicClient.mockReturnValue({ from: vi.fn(() => builder) });

    await getCachedProductCanonicalPaths('merchant-1', ['iphone-xr']);

    expect(mockCacheTag).toHaveBeenCalledWith(
      'products',
      'product-index-merchant-1',
      'categories-merchant-1'
    );
  });

  it('normalizes array-shaped category joins and skips blank slugs', async () => {
    const builder = createQueryBuilder({
      data: [
        {
          id: 'p1',
          name: 'iPhone XR',
          slug: 'iphone-xr',
          category: 'Smartphones',
          categories: [{ name: 'Smartphones', slug: 'smartphones' }],
        },
        {
          id: 'p2',
          name: 'AirPods 2',
          slug: 'apple-airpods-2',
          category: 'Earbuds',
          categories: { name: 'Earbuds', slug: '   ' },
        },
      ],
    });
    mockCreatePublicClient.mockReturnValue({ from: vi.fn(() => builder) });

    const paths = await getCachedProductCanonicalPaths('merchant-1', [
      'iphone-xr',
      'apple-airpods-2',
    ]);

    expect(paths['iphone-xr']).toBe('/smartphones/iphone-xr');
    // blank joined slug falls back to the legacy category text derivation
    expect(paths['apple-airpods-2']).toBe('/earbuds/apple-airpods-2');
  });

  it('prefers the active junction category over legacy text when the direct join is absent', async () => {
    const builder = createQueryBuilder({
      data: [
        {
          id: 'p1',
          name: 'JBL Clip 4',
          slug: 'jbl-clip-4',
          category: 'Audio',
          categories: null,
          product_categories: [
            { categories: { name: 'Speakers', slug: 'speakers' } },
          ],
        },
      ],
    });
    mockCreatePublicClient.mockReturnValue({ from: vi.fn(() => builder) });

    const paths = await getCachedProductCanonicalPaths('merchant-1', [
      'jbl-clip-4',
    ]);

    // The PDP snapshot canonicalizes by active direct join || active junction,
    // so content links must target the relation-backed path directly.
    expect(paths['jbl-clip-4']).toBe('/speakers/jbl-clip-4');
  });

  it('selects the lowest active junction category id regardless of response order', async () => {
    const builder = createQueryBuilder({
      data: [
        {
          id: 'p1',
          name: 'JBL Clip 4',
          slug: 'jbl-clip-4',
          category: 'Audio',
          categories: { is_active: false, slug: 'retired' },
          product_categories: [
            {
              category_id: 'category-z',
              categories: { is_active: true, slug: 'speakers-z' },
            },
            {
              category_id: 'category-a',
              categories: { is_active: true, slug: 'speakers-a' },
            },
          ],
        },
      ],
    });
    mockCreatePublicClient.mockReturnValue({ from: vi.fn(() => builder) });

    const paths = await getCachedProductCanonicalPaths('merchant-1', [
      'jbl-clip-4',
    ]);

    expect(paths['jbl-clip-4']).toBe('/speakers-a/jbl-clip-4');
    expect(builder.order).toHaveBeenCalledWith('category_id', {
      ascending: true,
      referencedTable: 'product_categories',
    });
  });

  it('falls back to the product_categories junction when direct join and legacy text are both absent', async () => {
    const builder = createQueryBuilder({
      data: [
        {
          id: 'p1',
          name: 'JBL Clip 4',
          slug: 'jbl-clip-4',
          category: null,
          categories: null,
          product_categories: [
            { categories: { name: 'Speakers', slug: 'speakers' } },
          ],
        },
      ],
    });
    mockCreatePublicClient.mockReturnValue({ from: vi.fn(() => builder) });

    const paths = await getCachedProductCanonicalPaths('merchant-1', [
      'jbl-clip-4',
    ]);

    expect(paths['jbl-clip-4']).toBe('/speakers/jbl-clip-4');
  });

  it('returns an empty map without querying when no slugs are requested', async () => {
    const paths = await getCachedProductCanonicalPaths('merchant-1', []);

    expect(paths).toEqual({});
    expect(mockCreatePublicClient).not.toHaveBeenCalled();
  });

  it('returns an empty map when the query fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const builder = createQueryBuilder({ error: { message: 'boom' } });
    mockCreatePublicClient.mockReturnValue({ from: vi.fn(() => builder) });

    const paths = await getCachedProductCanonicalPaths('merchant-1', [
      'iphone-xr',
    ]);

    expect(paths).toEqual({});
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('throws on query failure when throwOnQueryError is set', async () => {
    const builder = createQueryBuilder({ error: { message: 'boom' } });
    mockCreatePublicClient.mockReturnValue({ from: vi.fn(() => builder) });

    await expect(
      getCachedProductCanonicalPaths('merchant-1', ['iphone-xr'], {
        throwOnQueryError: true,
      })
    ).rejects.toEqual({ message: 'boom' });
  });
});
