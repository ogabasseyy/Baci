import { QueryClient } from '@tanstack/react-query';
import {
  getCachedOptionStock,
  getCachedProductStock,
} from './cart-query-cache';

function seedListPages(
  queryClient: QueryClient,
  pages: Array<{ products: unknown[] }>
) {
  queryClient.setQueryData(['products', 'merchant-1', {}], {
    pages: pages.map((page, index) => ({ ...page, nextOffset: index + 1 })),
    pageParams: pages.map((_, index) => index),
  });
}

function seedProductDetail(
  queryClient: QueryClient,
  slug: string,
  product: unknown
) {
  queryClient.setQueryData(
    ['product', 'variant-media-v2', slug, 'merchant-1'],
    product
  );
}

describe('cart query cache helpers', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  afterEach(() => {
    // TanStack Query schedules cache GC timers; clear them so Jest can exit.
    queryClient.clear();
  });

  it('returns the cached stock quantity from a later infinite-query page', () => {
    seedListPages(queryClient, [
      { products: [{ id: 'product-1', stock_quantity: 4 }] },
      { products: [{ id: 'product-2', stock_quantity: 9 }] },
    ]);

    expect(getCachedProductStock(queryClient, 'product-2')).toBe(9);
  });

  it('returns the cached stock quantity from a product-detail entry', () => {
    seedProductDetail(queryClient, 'gaming-beast', {
      id: 'product-2',
      slug: 'gaming-beast',
      stock_quantity: 7,
    });

    expect(getCachedProductStock(queryClient, 'product-2')).toBe(7);
  });

  it('returns the cached stock quantity from the flat launch-pins writer', () => {
    queryClient.setQueryData(
      ['products', 'merchant-1', 'launch-by-slugs', ['gaming-beast']],
      [{ id: 'product-2', stock_quantity: 5 }]
    );

    expect(getCachedProductStock(queryClient, 'product-2')).toBe(5);
  });

  it('returns undefined when cached products are missing', () => {
    expect(getCachedProductStock(queryClient, 'product-2')).toBeUndefined();
  });

  it('returns undefined when the cached products do not include the product', () => {
    seedListPages(queryClient, [
      { products: [{ id: 'product-1', stock_quantity: 4 }] },
    ]);

    expect(getCachedProductStock(queryClient, 'product-999')).toBeUndefined();
  });

  it('falls back to the parent cached stock when no option is named', () => {
    seedListPages(queryClient, [
      { products: [{ id: 'product-1', stock_quantity: 4 }] },
    ]);

    expect(getCachedOptionStock(queryClient, 'product-1')).toBe(4);
    expect(
      getCachedOptionStock(queryClient, 'product-1', {
        variantId: null,
        offerId: null,
      })
    ).toBe(4);
  });

  it('resolves the cached variant quantity instead of the parent total', () => {
    seedListPages(queryClient, [
      {
        products: [
          {
            id: 'product-1',
            stock_quantity: 0,
            variants: [{ id: 'variant-2', stock_quantity: 3 }],
          },
        ],
      },
    ]);

    expect(
      getCachedOptionStock(queryClient, 'product-1', { variantId: 'variant-2' })
    ).toBe(3);
  });

  it('resolves the cached variant quantity from a product-detail entry', () => {
    seedProductDetail(queryClient, 'gaming-beast', {
      id: 'product-1',
      slug: 'gaming-beast',
      stock_quantity: 0,
      variants: [{ id: 'variant-2', stock_quantity: 6 }],
    });

    expect(
      getCachedOptionStock(queryClient, 'product-1', { variantId: 'variant-2' })
    ).toBe(6);
  });

  it('prefers the variant identity when both option ids are present', () => {
    seedListPages(queryClient, [
      {
        products: [
          {
            id: 'product-1',
            stock_quantity: 0,
            variants: [{ id: 'variant-2', stock_quantity: 3 }],
            offers: [{ id: 'offer-7', stock_quantity: 9 }],
          },
        ],
      },
    ]);

    expect(
      getCachedOptionStock(queryClient, 'product-1', {
        variantId: 'variant-2',
        offerId: 'offer-7',
      })
    ).toBe(3);
  });

  it('caps the cached offer quantity at strict serialized base units', () => {
    seedListPages(queryClient, [
      {
        products: [
          {
            id: 'product-1',
            stock_quantity: 10,
            base_effective_policy: 'serialized_strict',
            base_available_units: 2,
            offers: [{ id: 'offer-7', stock_quantity: 5 }],
          },
        ],
      },
    ]);

    expect(
      getCachedOptionStock(queryClient, 'product-1', { offerId: 'offer-7' })
    ).toBe(2);
  });

  it('resolves the offer from the detail cache when the list row lacks offers', () => {
    // Opened from a PRODUCT_SELECT list row, then viewed: the list entry
    // carries no offers but the detail entry has the exact offer.
    seedListPages(queryClient, [
      { products: [{ id: 'product-1', stock_quantity: 10 }] },
    ]);
    seedProductDetail(queryClient, 'gaming-beast', {
      id: 'product-1',
      slug: 'gaming-beast',
      stock_quantity: 10,
      offers: [{ id: 'offer-7', stock_quantity: 5 }],
    });

    expect(
      getCachedOptionStock(queryClient, 'product-1', { offerId: 'offer-7' })
    ).toBe(5);
  });

  it('scans past a list entry that lacks the requested variant', () => {
    seedListPages(queryClient, [
      { products: [{ id: 'product-1', stock_quantity: 10 }] },
      {
        products: [
          {
            id: 'product-1',
            stock_quantity: 10,
            variants: [{ id: 'variant-2', stock_quantity: 3 }],
          },
        ],
      },
    ]);

    expect(
      getCachedOptionStock(queryClient, 'product-1', {
        variantId: 'variant-2',
      })
    ).toBe(3);
  });

  it('inherits parent stock from the selected detail entry, not the stale list row', () => {
    seedListPages(queryClient, [
      { products: [{ id: 'product-1', stock_quantity: 3 }] },
    ]);
    seedProductDetail(queryClient, 'gaming-beast', {
      id: 'product-1',
      slug: 'gaming-beast',
      stock_quantity: 10,
      offers: [{ id: 'offer-7' }],
    });

    // The offer scalar is absent (inherits parent): the detail entry's
    // own parent stock wins over the older list snapshot.
    expect(
      getCachedOptionStock(queryClient, 'product-1', { offerId: 'offer-7' })
    ).toBe(10);
  });

  it('fails closed when the cached option is missing', () => {
    seedListPages(queryClient, [
      {
        products: [
          {
            id: 'product-1',
            stock_quantity: 10,
            variants: [{ id: 'variant-2', stock_quantity: 3 }],
            offers: [],
          },
        ],
      },
    ]);

    expect(
      getCachedOptionStock(queryClient, 'product-1', { variantId: 'variant-9' })
    ).toBeUndefined();
    expect(
      getCachedOptionStock(queryClient, 'product-1', { offerId: 'offer-7' })
    ).toBeUndefined();
    expect(
      getCachedOptionStock(queryClient, 'product-999', { offerId: 'offer-7' })
    ).toBeUndefined();
  });
});
