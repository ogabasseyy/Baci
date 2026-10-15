import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('../lib/storage', () => ({
  syncStorage: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

import { useCartStore } from './cart-store';
import type { CartItem } from './cart-store.types';
import {
  applyReprice,
  formatPrice,
  selectCartQuantities,
} from './cart-store-selectors';

function cartItem(id: string, productId: string, quantity: number): CartItem {
  return {
    id,
    product_id: productId,
    slug: productId,
    name: productId,
    price: 1000,
    quantity,
  };
}

describe('selectCartQuantities', () => {
  it('formats naira prices without fractional digits', () => {
    expect(formatPrice(470000)).toBe('₦470,000');
  });

  beforeEach(() => {
    useCartStore.setState({ items: [], isLoading: false, lineSequence: 0 });
  });

  it('sums quantities per product across cart lines', () => {
    useCartStore.setState({
      items: [
        cartItem('line-1', 'p1', 2),
        cartItem('line-2', 'p1', 3),
        cartItem('line-3', 'p2', 1),
      ],
      isLoading: false,
      lineSequence: 3,
    });

    const counts = selectCartQuantities(useCartStore.getState());

    expect(counts.get('p1')).toBe(5);
    expect(counts.get('p2')).toBe(1);
    expect(counts.get('p3') ?? 0).toBe(0);
  });

  it('memoizes the map until items change', () => {
    useCartStore.setState({
      items: [cartItem('line-1', 'p1', 1)],
      isLoading: false,
      lineSequence: 1,
    });
    const first = selectCartQuantities(useCartStore.getState());

    expect(selectCartQuantities(useCartStore.getState())).toBe(first);

    useCartStore.setState({
      items: [cartItem('line-1', 'p1', 1), cartItem('line-2', 'p2', 1)],
      isLoading: false,
      lineSequence: 2,
    });

    expect(selectCartQuantities(useCartStore.getState())).not.toBe(first);
  });
});

describe('applyReprice', () => {
  function offerLine(overrides: Partial<CartItem> = {}): CartItem {
    return {
      id: 'line-1',
      product_id: 'p1',
      slug: 'p1',
      name: 'p1',
      price: 1000,
      quantity: 1,
      condition: 'Used',
      variant_attributes: { condition: 'Used', storage: '256GB' },
      ...overrides,
    };
  }

  it('refreshes the line and its condition attribute to the live display value', () => {
    const { items } = applyReprice(
      {
        items: [offerLine()],
        cartWideNegotiationActive: false,
      },
      {},
      { 'line-1': 'open_box' }
    );
    expect(items[0].condition).toBe('Open Box');
    expect(items[0].variant_attributes).toEqual({
      condition: 'Open Box',
      storage: '256GB',
    });
  });

  it('leaves attributes without a condition key alone instead of inventing a label part', () => {
    const { items } = applyReprice(
      {
        items: [offerLine({ variant_attributes: { storage: '256GB' } })],
        cartWideNegotiationActive: false,
      },
      {},
      { 'line-1': 'open_box' }
    );
    expect(items[0].condition).toBe('Open Box');
    expect(items[0].variant_attributes).toEqual({ storage: '256GB' });
  });

  it('returns the same item when nothing drifted', () => {
    const line = offerLine();
    const { items } = applyReprice(
      { items: [line], cartWideNegotiationActive: false },
      {},
      {}
    );
    expect(items[0]).toBe(line);
  });
});
