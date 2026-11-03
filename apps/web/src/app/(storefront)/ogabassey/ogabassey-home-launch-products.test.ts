import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCachedStorefrontLaunchProducts,
  type StorefrontHomeProduct,
} from '@/lib/cached-data';
import { getCachedStorefrontProductsBySlugs } from '@/lib/cached-storefront-products-by-slugs';
import {
  loadOgabasseyLaunchProducts,
  selectOgabasseyLaunchProducts,
  sortByNewestCreated,
} from './ogabassey-home-launch-products';

vi.mock('@/lib/cached-data', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getCachedStorefrontLaunchProducts: vi.fn(),
  };
});

vi.mock('@/lib/cached-storefront-products-by-slugs', () => ({
  getCachedStorefrontProductsBySlugs: vi.fn(),
}));

function createRow(
  overrides: Partial<StorefrontHomeProduct> = {}
): StorefrontHomeProduct {
  return {
    id: 'product-1',
    name: 'Samsung Galaxy A27 5G',
    slug: 'samsung-galaxy-a27-5g',
    price: 50000,
    images: ['https://cdn.ogabassey.com/products/a27.avif'],
    category: 'Smartphones',
    brand: 'Samsung',
    condition: 'new',
    stock: 2,
    stock_quantity: null,
    manage_stock: false,
    low_stock_threshold: null,
    product_categories: [],
    ...overrides,
  };
}

describe('ogabassey home launch products', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCachedStorefrontLaunchProducts).mockResolvedValue([]);
    vi.mocked(getCachedStorefrontProductsBySlugs).mockResolvedValue([]);
  });

  it('sorts missing timestamps last while preserving newest-created order', () => {
    expect(
      sortByNewestCreated([
        { id: 'old', created_at: '2026-05-01T00:00:00.000Z' },
        { id: 'missing' },
        { id: 'new', created_at: '2026-06-01T00:00:00.000Z' },
      ]).map((row) => row.id)
    ).toEqual(['new', 'old', 'missing']);
  });

  it('selects renderable launch products with newer additions ahead of pins', () => {
    const products = selectOgabasseyLaunchProducts({
      launchCandidateRows: [
        createRow({
          id: 'newer',
          name: 'New Arrival',
          slug: 'new-arrival',
          created_at: '2026-10-30T00:00:00.000Z',
        }),
        createRow({
          id: 'unrenderable',
          name: 'No Image',
          slug: 'no-image',
          images: [],
          created_at: '2026-10-31T00:00:00.000Z',
        }),
      ],
      pinnedProductRows: [
        createRow({
          id: 'pin',
          name: 'Pinned iPhone Duo',
          slug: 'iphone-duo',
          created_at: '2026-10-25T00:00:00.000Z',
        }),
      ],
    });

    expect(products.map((product) => product.name)).toEqual([
      'New Arrival',
      'Pinned iPhone Duo',
    ]);
  });

  it('hoists the first CDN-backed product to slide 0 when the top candidate uses a third-party image origin', () => {
    const products = selectOgabasseyLaunchProducts({
      launchCandidateRows: [
        createRow({
          id: 'external-lead',
          name: 'External Image Phone',
          slug: 'external-image-phone',
          images: ['https://images.samsung.com/external-flip.jpg'],
          created_at: '2026-10-31T00:00:00.000Z',
        }),
      ],
      pinnedProductRows: [
        createRow({
          id: 'cdn-pin',
          name: 'iPhone Duo',
          slug: 'iphone-duo',
          images: [
            'https://cdn.ogabassey.com/core-assets/products/iphone-duo-night-sky-20261026.avif',
          ],
          created_at: '2026-10-25T00:00:00.000Z',
        }),
      ],
    });

    expect(products.map((product) => product.name)).toEqual([
      'iPhone Duo',
      'External Image Phone',
    ]);
  });

  it('keeps full untruncated descriptions so home JSON-LD markup is unchanged', () => {
    const longDescription = `<h2>What is the Galaxy A27 Price in Nigeria?</h2><p>${'C'.repeat(400)}</p>`;

    const products = selectOgabasseyLaunchProducts({
      launchCandidateRows: [
        createRow({
          id: 'launch',
          name: 'Launch Device',
          slug: 'launch-device',
          description: longDescription,
          created_at: '2026-06-24T00:00:00.000Z',
        }),
      ],
      pinnedProductRows: [],
    });

    expect(products[0]?.description).toBe(longDescription);
  });

  it('loads launch and pinned rows for the streamed hero without failing on missing pins', async () => {
    vi.mocked(getCachedStorefrontLaunchProducts).mockResolvedValue([
      createRow({ id: 'launch', name: 'Launch Device' }),
    ]);
    vi.mocked(getCachedStorefrontProductsBySlugs).mockRejectedValue(
      new Error('temporary cache miss')
    );

    const products = await loadOgabasseyLaunchProducts('merchant-1');

    expect(getCachedStorefrontLaunchProducts).toHaveBeenCalledWith(
      'merchant-1'
    );
    expect(getCachedStorefrontProductsBySlugs).toHaveBeenCalledWith(
      'merchant-1',
      expect.arrayContaining(['iphone-duo'])
    );
    expect(products.map((product) => product.name)).toEqual(['Launch Device']);
  });

  it('degrades to an empty list when the launch candidate feed rejects', async () => {
    // The candidate leg drives the visible hero; a Supabase/cache failure must
    // not reject (it would crash the awaiting hero section + homepage).
    vi.mocked(getCachedStorefrontLaunchProducts).mockRejectedValue(
      new Error('launch feed down')
    );
    vi.mocked(getCachedStorefrontProductsBySlugs).mockResolvedValue([
      createRow({ id: 'pin', name: 'Pinned A27' }),
    ]);

    const products = await loadOgabasseyLaunchProducts('merchant-1');

    // Only the pinned rows survive; the function resolves instead of throwing.
    expect(products.map((product) => product.name)).toEqual(['Pinned A27']);
  });

  it('resolves to an empty list when both launch feeds reject', async () => {
    vi.mocked(getCachedStorefrontLaunchProducts).mockRejectedValue(
      new Error('launch feed down')
    );
    vi.mocked(getCachedStorefrontProductsBySlugs).mockRejectedValue(
      new Error('pinned feed down')
    );

    await expect(loadOgabasseyLaunchProducts('merchant-1')).resolves.toEqual(
      []
    );
  });
});
