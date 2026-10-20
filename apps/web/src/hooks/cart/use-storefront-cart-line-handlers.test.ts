import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CartItem } from './cart-types';
import { useStorefrontCartLineHandlers } from './use-storefront-cart-line-handlers';

const product = {
  id: 'prod-1',
  price: 100,
  name: 'Phone',
} as never;

function setup(overrides: Record<string, unknown> = {}) {
  const setCart = vi.fn();
  const delegatedActions = {
    addToCart: vi.fn(() => true),
    removeFromCart: vi.fn(),
    updateQuantity: vi.fn(),
  };
  const { result } = renderHook(() =>
    useStorefrontCartLineHandlers({
      cartRef: { current: [] },
      cartWideNegotiationActiveRef: { current: false },
      delegated: false,
      delegatedActions,
      enableSmartCartPro: false,
      merchantContext: null,
      merchantSlugRef: { current: null },
      setCart,
      setCartWideNegotiationActive: vi.fn(),
      setLastAddedProduct: vi.fn(),
      setShowUpsell: vi.fn(),
      upsellTimerRef: { current: null },
      ...overrides,
    } as never)
  );
  return { result, setCart, delegatedActions };
}

describe('useStorefrontCartLineHandlers', () => {
  it('appends a legacy line through the cart updater', () => {
    const { result, setCart } = setup();
    result.current.addToCart(product, 2);
    const updater = setCart.mock.calls[0][0] as (
      prev: CartItem[]
    ) => CartItem[];
    const next = updater([]);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ id: 'prod-1', quantity: 2 });
  });

  it('delegates adds, removals, and quantity changes when delegated', () => {
    const { result, setCart, delegatedActions } = setup({
      delegated: true,
    });
    result.current.addToCart(product, 1);
    result.current.removeFromCart('line-1');
    result.current.updateQuantity('line-1', 3);
    expect(delegatedActions.addToCart).toHaveBeenCalled();
    expect(delegatedActions.removeFromCart).toHaveBeenCalledWith(
      'line-1',
      undefined
    );
    expect(delegatedActions.updateQuantity).toHaveBeenCalledWith(
      'line-1',
      3,
      undefined
    );
    expect(setCart).not.toHaveBeenCalled();
  });

  it('removes a legacy line at quantity zero', () => {
    const { result, setCart } = setup();
    result.current.updateQuantity('prod-1', 0);
    const updater = setCart.mock.calls[0][0] as (
      prev: CartItem[]
    ) => CartItem[];
    const prev = [{ id: 'prod-1', quantity: 1 }] as CartItem[];
    expect(updater(prev)).toEqual([]);
  });
});
