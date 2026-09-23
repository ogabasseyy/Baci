import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/hooks/cart';
import { useCartSidebarNegotiation } from './use-cart-sidebar-negotiation';

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    cartItemId: 'line-1',
    id: 'prod-1',
    name: 'iPhone 15',
    brand: 'Apple',
    price: 500000,
    quantity: 2,
    ...overrides,
  } as CartItem;
}

function setup({
  cart = [makeItem()],
  cartTotal = 1000000,
  hasNonNegotiableCartItem = false,
}: {
  cart?: CartItem[];
  cartTotal?: number;
  hasNonNegotiableCartItem?: boolean;
} = {}) {
  const applyNegotiatedPrice = vi.fn();
  const applyCartWideNegotiation = vi.fn();
  const clearNegotiatedPrice = vi.fn();
  const hook = renderHook(() =>
    useCartSidebarNegotiation({
      cart,
      cartTotal,
      hasNonNegotiableCartItem,
      applyNegotiatedPrice,
      applyCartWideNegotiation,
      clearNegotiatedPrice,
    })
  );
  return {
    ...hook,
    applyNegotiatedPrice,
    applyCartWideNegotiation,
    clearNegotiatedPrice,
  };
}

describe('useCartSidebarNegotiation', () => {
  it('opens single-item negotiation at the line total', () => {
    const { result } = setup();

    act(() => {
      result.current.openItemNegotiation(makeItem());
    });

    expect(result.current.negotiationState).toMatchObject({
      isOpen: true,
      type: 'single',
      currentPrice: 1000000,
      name: 'iPhone 15 (x2)',
    });
  });

  it('ignores negotiation for non-negotiable products', () => {
    const { result } = setup();

    act(() => {
      result.current.openItemNegotiation(
        makeItem({ brand: 'Samsung', name: 'Galaxy A54' })
      );
    });

    expect(result.current.negotiationState).toBeNull();
  });

  it('applies the negotiated unit price on single success', () => {
    const { result, applyNegotiatedPrice } = setup();

    act(() => {
      result.current.openItemNegotiation(makeItem());
    });
    act(() => {
      result.current.handleNegotiationSuccess(900000);
    });

    // finalPrice is the line total; the hook converts to a unit price.
    expect(applyNegotiatedPrice).toHaveBeenCalledWith('line-1', 450000);
  });

  it('applies the cart-wide total on total success', () => {
    const { result, applyCartWideNegotiation } = setup();

    act(() => {
      result.current.openTotalNegotiation();
    });
    expect(result.current.negotiationState).toMatchObject({
      type: 'total',
      name: 'Entire Cart',
    });

    act(() => {
      result.current.handleNegotiationSuccess(800000);
    });
    expect(applyCartWideNegotiation).toHaveBeenCalledWith(800000);
  });

  it('refuses total negotiation when a line is non-negotiable', () => {
    const { result } = setup({ hasNonNegotiableCartItem: true });

    act(() => {
      result.current.openTotalNegotiation();
    });

    expect(result.current.negotiationState).toBeNull();
  });

  it('clears the state on close', () => {
    const { result } = setup();

    act(() => {
      result.current.openItemNegotiation(makeItem());
    });
    expect(result.current.negotiationState).not.toBeNull();

    act(() => {
      result.current.closeNegotiation();
    });
    expect(result.current.negotiationState).toBeNull();
  });
});
