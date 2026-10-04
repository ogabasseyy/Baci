import { beforeEach, describe, expect, it } from 'vitest';
import { getMerchantCartState } from './merchant-cart-storage';

describe('getMerchantCartState', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads cart lines and negotiation state from one merchant namespace', () => {
    localStorage.setItem(
      'baci-cart-winter-store-guest',
      JSON.stringify([{ id: 'phone', name: 'Phone', price: 100, quantity: 1 }])
    );
    localStorage.setItem('baci-cart-winter-store-group-negotiation', 'true');

    expect(getMerchantCartState('winter-store')).toEqual({
      cart: [
        expect.objectContaining({
          id: 'phone',
          name: 'Phone',
          price: 100,
          quantity: 1,
        }),
      ],
      cartWideNegotiationActive: true,
    });
  });
});
