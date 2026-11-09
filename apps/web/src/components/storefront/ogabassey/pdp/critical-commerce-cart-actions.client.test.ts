import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product as CartProduct } from '@/lib/products';
import { useCriticalCommerceCartActions } from './critical-commerce-cart-actions.client';

const cartMocks = vi.hoisted(() => ({
  addToCart: vi.fn(),
  cart: [] as Array<Record<string, unknown>>,
  removeFromCart: vi.fn(),
  setIsCartOpen: vi.fn(),
  updateQuantity: vi.fn(),
}));

vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    addToCart: cartMocks.addToCart,
    cart: cartMocks.cart,
    removeFromCart: cartMocks.removeFromCart,
    setIsCartOpen: cartMocks.setIsCartOpen,
    updateQuantity: cartMocks.updateQuantity,
  }),
}));

const productForCart: CartProduct = {
  condition: 'new',
  has_variants: false,
  id: 'simple-1',
  name: 'Simple Widget',
  price: 5000,
} as unknown as CartProduct;

describe('useCriticalCommerceCartActions', () => {
  beforeEach(() => {
    cartMocks.addToCart.mockClear();
    cartMocks.removeFromCart.mockClear();
    cartMocks.setIsCartOpen.mockClear();
    cartMocks.updateQuantity.mockClear();
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

  it('adds with the shared options without forcing the cart drawer open', () => {
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
    expect(cartMocks.setIsCartOpen).not.toHaveBeenCalled();
  });

  it('increments, decrements, and removes the matching cart line', () => {
    cartMocks.cart = [
      {
        cartItemId: 'simple-1::condition=new',
        condition: 'new',
        id: 'simple-1',
        quantity: 2,
      },
    ];
    const { result, rerender } = renderHook(() =>
      useCriticalCommerceCartActions({
        activeRouteOffer: null,
        canAddToCart: true,
        effectivePurchasableVariantSelection: null,
        maxQuantity: 3,
        productForCart,
        quantity: 1,
      })
    );

    act(() => {
      result.current.handleIncrementCartQuantity();
    });
    expect(cartMocks.updateQuantity).toHaveBeenCalledWith(
      'simple-1::condition=new',
      3,
      undefined
    );

    act(() => {
      result.current.handleDecrementCartQuantity();
    });
    expect(cartMocks.updateQuantity).toHaveBeenCalledWith(
      'simple-1::condition=new',
      1,
      undefined
    );

    cartMocks.cart = [
      {
        cartItemId: 'simple-1::condition=new',
        condition: 'new',
        id: 'simple-1',
        quantity: 1,
      },
    ];
    rerender();

    act(() => {
      result.current.handleDecrementCartQuantity();
    });
    expect(cartMocks.removeFromCart).toHaveBeenCalledWith(
      'simple-1::condition=new',
      undefined
    );
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

  it('does not increment beyond maxQuantity and removes the line when decrementing at minimum_order_quantity', () => {
    cartMocks.cart = [
      {
        cartItemId: 'simple-1::condition=new',
        condition: 'new',
        id: 'simple-1',
        minimum_order_quantity: 2,
        quantity: 2,
      },
    ];
    const { result } = renderHook(() =>
      useCriticalCommerceCartActions({
        activeRouteOffer: null,
        canAddToCart: true,
        effectivePurchasableVariantSelection: null,
        maxQuantity: 2,
        productForCart: {
          ...productForCart,
          minimum_order_quantity: 2,
        } as never,
        quantity: 2,
      })
    );

    expect(result.current.isAtMinCartQuantity).toBe(true);

    act(() => {
      result.current.handleIncrementCartQuantity();
    });
    expect(cartMocks.updateQuantity).not.toHaveBeenCalled();

    act(() => {
      result.current.handleDecrementCartQuantity();
    });
    expect(cartMocks.removeFromCart).toHaveBeenCalledWith(
      'simple-1::condition=new',
      undefined
    );
  });
});
