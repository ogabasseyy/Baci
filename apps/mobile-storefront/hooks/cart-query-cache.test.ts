import { QueryClient } from '@tanstack/react-query';
import {
  getCachedOptionStock,
  getCachedProductStock,
} from './cart-query-cache';

describe('cart query cache helpers', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  afterEach(() => {
    // TanStack Query schedules cache GC timers; clear them so Jest can exit.
    queryClient.clear();
  });

  it('returns the cached stock quantity for a product', () => {
    queryClient.setQueryData(
      ['products', 'featured'],
      [
        { id: 'product-1', stock_quantity: 4 },
        { id: 'product-2', stock_quantity: 9 },
      ]
    );

    expect(getCachedProductStock(queryClient, 'product-2')).toBe(9);
  });

  it('returns undefined when cached products are missing', () => {
    expect(getCachedProductStock(queryClient, 'product-2')).toBeUndefined();
  });

  it('returns undefined when the cached products do not include the product', () => {
    queryClient.setQueryData(
      ['products', 'featured'],
      [{ id: 'product-1', stock_quantity: 4 }]
    );

    expect(getCachedProductStock(queryClient, 'product-999')).toBeUndefined();
  });

  it('falls back to the parent cached stock when no option is named', () => {
    queryClient.setQueryData(
      ['products', 'featured'],
      [{ id: 'product-1', stock_quantity: 4 }]
    );

    expect(getCachedOptionStock(queryClient, 'product-1')).toBe(4);
    expect(
      getCachedOptionStock(queryClient, 'product-1', {
        variantId: null,
        offerId: null,
      })
    ).toBe(4);
  });

  it('resolves the cached variant quantity instead of the parent total', () => {
    queryClient.setQueryData(
      ['products', 'featured'],
      [
        {
          id: 'product-1',
          stock_quantity: 0,
          variants: [{ id: 'variant-2', stock_quantity: 3 }],
        },
      ]
    );

    expect(
      getCachedOptionStock(queryClient, 'product-1', { variantId: 'variant-2' })
    ).toBe(3);
  });

  it('prefers the variant identity when both option ids are present', () => {
    queryClient.setQueryData(
      ['products', 'featured'],
      [
        {
          id: 'product-1',
          stock_quantity: 0,
          variants: [{ id: 'variant-2', stock_quantity: 3 }],
          offers: [{ id: 'offer-7', stock_quantity: 9 }],
        },
      ]
    );

    expect(
      getCachedOptionStock(queryClient, 'product-1', {
        variantId: 'variant-2',
        offerId: 'offer-7',
      })
    ).toBe(3);
  });

  it('caps the cached offer quantity at strict serialized base units', () => {
    queryClient.setQueryData(
      ['products', 'featured'],
      [
        {
          id: 'product-1',
          stock_quantity: 10,
          base_effective_policy: 'serialized_strict',
          base_available_units: 2,
          offers: [{ id: 'offer-7', stock_quantity: 5 }],
        },
      ]
    );

    expect(
      getCachedOptionStock(queryClient, 'product-1', { offerId: 'offer-7' })
    ).toBe(2);
  });

  it('fails closed when the cached option is missing', () => {
    queryClient.setQueryData(
      ['products', 'featured'],
      [
        {
          id: 'product-1',
          stock_quantity: 10,
          variants: [{ id: 'variant-2', stock_quantity: 3 }],
          offers: [],
        },
      ]
    );

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
