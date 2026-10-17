import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CartItem } from './cart-types';
import { useStorefrontCartNegotiationHandlers } from './use-storefront-cart-negotiation-handlers';

const cart = [
  { cartItemId: 'line-1', id: 'prod-1', price: 100, quantity: 2 },
] as CartItem[];

function setup(overrides: Record<string, unknown> = {}) {
  const setCart = vi.fn();
  const delegatedActions = {
    applyCartWideNegotiation: vi.fn(),
    applyNegotiatedPrice: vi.fn(),
    clearNegotiatedPrice: vi.fn(),
    toggleAssurance: vi.fn(),
  };
  const { result } = renderHook(() =>
    useStorefrontCartNegotiationHandlers({
      cart,
      cartWideNegotiationActiveRef: { current: false },
      delegated: false,
      delegatedActions,
      enableSmartCartPro: true,
      setCart,
      setCartWideNegotiationActive: vi.fn(),
      setShowUpsell: vi.fn(),
      ...overrides,
    } as never)
  );
  return { result, setCart, delegatedActions };
}

describe('useStorefrontCartNegotiationHandlers', () => {
  it('applies a negotiated price to the matching legacy line', () => {
    const { result, setCart } = setup();
    result.current.applyNegotiatedPrice('line-1', 80);
    const updater = setCart.mock.calls[0][0] as (
      prev: CartItem[]
    ) => CartItem[];
    expect(updater(cart)[0]).toMatchObject({
      negotiatedPrice: 80,
      negotiationStatus: 'accepted',
    });
  });

  it('distributes a cart-wide negotiation proportionally', () => {
    const { result, setCart } = setup();
    result.current.applyCartWideNegotiation(100);
    const updater = setCart.mock.calls[0][0] as (
      prev: CartItem[]
    ) => CartItem[];
    expect(updater(cart)[0]).toMatchObject({ negotiatedPrice: 50 });
  });

  it('does nothing without Smart Cart Pro', () => {
    const { result, setCart, delegatedActions } = setup({
      enableSmartCartPro: false,
    });
    result.current.applyNegotiatedPrice('line-1', 80);
    result.current.toggleAssurance('line-1');
    expect(setCart).not.toHaveBeenCalled();
    expect(delegatedActions.applyNegotiatedPrice).not.toHaveBeenCalled();
  });

  it('delegates negotiation actions when delegated', () => {
    const { result, delegatedActions } = setup({ delegated: true });
    result.current.applyNegotiatedPrice('line-1', 80);
    result.current.toggleAssurance('line-1');
    expect(delegatedActions.applyNegotiatedPrice).toHaveBeenCalledWith(
      'line-1',
      80
    );
    expect(delegatedActions.toggleAssurance).toHaveBeenCalledWith('line-1');
  });
});
