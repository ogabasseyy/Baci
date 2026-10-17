import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCriticalCommerceCartActions } from './critical-commerce-cart-actions.client';

const cartMocks = vi.hoisted(() => ({
  addToCart: vi.fn(),
  cart: [] as Array<Record<string, unknown>>,
  setIsCartOpen: vi.fn(),
}));

vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    addToCart: cartMocks.addToCart,
    cart: cartMocks.cart,
    setIsCartOpen: cartMocks.setIsCartOpen,
  }),
}));

const productForCart = {
  condition: 'new',
  has_variants: false,
  id: 'simple-1',
  name: 'Simple Widget',
  price: 5000,
} as never;

describe('useCriticalCommerceCartActions', () => {
  beforeEach(() => {
    cartMocks.addToCart.mockClear();
    cartMocks.setIsCartOpen.mockClear();
    cartMocks.cart = [];
  });

  it('reports zero in-cart units for a fresh selection', () => {
    const { result } = renderHook(() =>
      useCriticalCommerceCartActions({
        activeRouteOffer: null,
        canAddToCart: true,
        effectivePurchasableVariantSelection: null,
        productForCart,
        quantity: 1,
      })
    );

    expect(result.current.quantityInCart).toBe(0);
  });

  it('reports the merging line quantity for the exact selection', () => {
    cartMocks.cart = [{ id: 'simple-1', condition: 'new', quantity: 2 }];
    const { result } = renderHook(() =>
      useCriticalCommerceCartActions({
        activeRouteOffer: null,
        canAddToCart: true,
        effectivePurchasableVariantSelection: null,
        productForCart,
        quantity: 1,
      })
    );

    expect(result.current.quantityInCart).toBe(2);
  });

  it('adds with the shared options and opens the cart', () => {
    const { result } = renderHook(() =>
      useCriticalCommerceCartActions({
        activeRouteOffer: null,
        canAddToCart: true,
        effectivePurchasableVariantSelection: null,
        productForCart,
        quantity: 3,
      })
    );

    act(() => {
      result.current.handleAddToCart();
    });

    expect(cartMocks.addToCart).toHaveBeenCalledWith(
      productForCart,
      3,
      expect.objectContaining({ condition: 'new' })
    );
    expect(cartMocks.setIsCartOpen).toHaveBeenCalledWith(true);
  });

  it('refuses to add when purchasing is disabled', () => {
    const { result } = renderHook(() =>
      useCriticalCommerceCartActions({
        activeRouteOffer: null,
        canAddToCart: false,
        effectivePurchasableVariantSelection: null,
        productForCart,
        quantity: 1,
      })
    );

    act(() => {
      result.current.handleAddToCart();
    });

    expect(cartMocks.addToCart).not.toHaveBeenCalled();
    expect(cartMocks.setIsCartOpen).not.toHaveBeenCalled();
  });
});
