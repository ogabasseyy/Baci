import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cacheTag } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCachedDataTestHarness,
  type CachedDataTestHarness,
  resetMockCreateClient,
} from '@/lib/cached-data.test-utils';
import { getCachedStorefrontProductsBySlugs } from '@/lib/cached-storefront-products-by-slugs';

vi.mock('@/env', () => ({
  getSupabaseUrl: vi.fn(() => 'https://test.supabase.co'),
  getSupabaseAnonKey: vi.fn(() => 'test-anon-key'),
  getSupabaseServiceRoleKey: vi.fn(() => 'test-service-role-key'),
}));

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('react', () => ({ cache: vi.fn((fn) => fn) }));
vi.mock('@/lib/public-serialized-variant-summary', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/public-serialized-variant-summary')
  >('@/lib/public-serialized-variant-summary');

  return {
    ...actual,
    getPublicSerializedVariantSummariesByProductId: vi.fn(() =>
      Promise.resolve([])
    ),
  };
});
vi.mock('@supabase/supabase-js', async () => {
  const { getMockCreateClient } = await import('@/lib/cached-data.test-utils');
  return {
    createClient: (...args: unknown[]) => {
      const createClient = getMockCreateClient();
      if (!createClient) {
        return { from: () => ({ select: () => ({}) }), auth: {} };
      }
      return createClient(...args);
    },
  };
});

let harness: CachedDataTestHarness;

beforeEach(() => {
  harness = buildCachedDataTestHarness();
});

afterEach(() => {
  resetMockCreateClient();
  vi.restoreAllMocks();
});

describe('getCachedStorefrontProductsBySlugs', () => {
  const slugs = ['samsung-galaxy-a27-5g', 'itel-power-80-128gb-4gb'];

  it('builds a merchant-scoped, active, slug-filtered query with an explicit select', async () => {
    harness.mockListResult.data = [
      { id: 'p1', slug: 'samsung-galaxy-a27-5g' },
      { id: 'p2', slug: 'itel-power-80-128gb-4gb' },
    ];

    await getCachedStorefrontProductsBySlugs('merchant-123', slugs);

    expect(harness.mockEq).toHaveBeenCalledWith('merchant_id', 'merchant-123');
    expect(harness.mockEq).toHaveBeenCalledWith('status', 'active');
    expect(harness.mockIn).toHaveBeenCalledWith('slug', slugs);

    const selectArg = String(harness.mockSelect.mock.calls.at(-1)?.[0]);
    expect(selectArg).not.toContain('*');
    expect(selectArg).toContain('id');
    expect(selectArg).toContain('name');
    expect(selectArg).toContain('slug');
    expect(selectArg).toContain('images');
    expect(selectArg).toContain('price');
    expect(selectArg).toContain('has_condition_offers');
    expect(selectArg).toContain('product_categories(categories(name, slug))');
    // FK category join so a pin with only category_id (no M2M row) still
    // resolves a category for its PDP deep-link.
    expect(selectArg).toContain(
      'categories:category_id(id, name, slug, parent_id)'
    );
  });

  it('returns the hydrated rows for the requested slugs', async () => {
    harness.mockListResult.data = [
      { id: 'p1', slug: 'samsung-galaxy-a27-5g' },
      { id: 'p2', slug: 'itel-power-80-128gb-4gb' },
    ];

    await expect(
      getCachedStorefrontProductsBySlugs('merchant-123', slugs)
    ).resolves.toEqual([
      expect.objectContaining({ id: 'p1', slug: 'samsung-galaxy-a27-5g' }),
      expect.objectContaining({ id: 'p2', slug: 'itel-power-80-128gb-4gb' }),
    ]);
  });

  it('prices a pinned phone by its purchasable cellular variant', async () => {
    harness.mockListResult.data = [
      {
        id: 'phone',
        name: 'iPhone 16',
        slug: slugs[0],
        category: 'Smartphones',
        price: 600000,
        compare_at_price: 800000,
        has_variants: true,
        variant_model: 'sku_matrix',
        manage_stock: false,
      },
    ];
    harness.mockRpc.mockResolvedValue({
      error: null,
      data: [
        {
          id: 'wifi',
          product_id: 'phone',
          attributes: { sim_type: 'Wi-Fi Only', storage: '128GB' },
          price_override: 600000,
          condition: 'used',
          stock_quantity: 1,
        },
        {
          id: 'cellular',
          product_id: 'phone',
          attributes: { sim_type: 'Physical + eSIM', storage: '128GB' },
          price_override: 900000,
          condition: 'used',
          stock_quantity: 1,
        },
      ],
    });

    await expect(
      getCachedStorefrontProductsBySlugs('merchant-123', slugs, true)
    ).resolves.toEqual([
      expect.objectContaining({
        advertised_price: 900000,
        advertised_compare_at_price: null,
      }),
    ]);
  });

  it('tags the cache so revalidateProducts() busts it', async () => {
    harness.mockListResult.data = [];

    await getCachedStorefrontProductsBySlugs('merchant-123', slugs);

    expect(cacheTag).toHaveBeenCalledWith(
      'products',
      'products-merchant-123',
      'products-by-slugs-merchant-123'
    );
  });

  it('throws on query error (so a broken .in()/select fails loudly)', async () => {
    harness.mockListResult.data = null;
    harness.mockListResult.error = { message: 'db error', code: '42P01' };
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(
      getCachedStorefrontProductsBySlugs('merchant-123', slugs)
    ).rejects.toEqual(expect.objectContaining({ message: 'db error' }));
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('short-circuits to [] for an empty slug list without querying', async () => {
    await expect(
      getCachedStorefrontProductsBySlugs('merchant-123', [])
    ).resolves.toEqual([]);

    expect(harness.mockFrom).not.toHaveBeenCalled();
    expect(harness.mockIn).not.toHaveBeenCalled();
  });
});

describe('cached-storefront-products-by-slugs cache directive', () => {
  const source = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      'cached-storefront-products-by-slugs.ts'
    ),
    'utf8'
  );

  it('stays on the shared remote cache handler so tag invalidation reaches every instance (PR4b review)', () => {
    // Codex review (PR #3108): this reader feeds the pinned launch carousel on
    // the ogabassey home page. Its freshness contract depends on
    // revalidateProducts() tag busting propagating to ALL instances — local
    // 'use cache' entries only see same-instance revalidation, so a demotion
    // serves stale pinned products after merchant edits. Bounded payload +
    // low-cardinality key = legitimate KEEP; joins the PR4d resilient-adapter
    // migration set (inventory doc §8).
    expect(source).toContain("'use cache: remote';");
  });
});
