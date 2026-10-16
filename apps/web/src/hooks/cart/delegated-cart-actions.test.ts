import { expect, it, vi } from 'vitest';
import type { SharedCartDisplayItem } from './cart-types';
import { createDelegatedCartActions } from './delegated-cart-actions';

function setup() {
  const cart: SharedCartDisplayItem[] = [
    {
      description: '',
      status: 'active',
      manage_stock: false,
      stock: 10,
      image: '',
      imageLarge: '',
      imageHint: '',
      brand: '',
      gtin: '',
      mpn: '',
      id: 'p',
      cartItemId: 'a',
      name: 'Phone',
      price: 100,
      quantity: 1,
      negotiatedPrice: 90,
    },
    {
      description: '',
      status: 'active',
      manage_stock: false,
      stock: 10,
      image: '',
      imageLarge: '',
      imageHint: '',
      brand: '',
      gtin: '',
      mpn: '',
      id: 'q',
      cartItemId: 'b',
      name: 'Case',
      price: 50,
      quantity: 2,
      negotiatedPrice: 40,
    },
  ];
  const calls: string[] = [];
  const shared = {
    cart,
    repriceLine: vi.fn((line: SharedCartDisplayItem) => {
      calls.push(`reprice:${line.cartItemId}`);
    }),
    updateQuantity: vi.fn(() => {
      calls.push('quantity');
    }),
    removeFromCart: vi.fn(() => {
      calls.push('remove');
    }),
    addToCart: vi.fn(),
    clearCart: vi.fn(),
    toggleAssurance: vi.fn(),
  };
  const active = { current: true };
  const setActive = vi.fn((value: boolean) => {
    active.current = value;
  });
  return {
    shared,
    calls,
    active,
    setActive,
    actions: createDelegatedCartActions(shared, active, setActive),
  };
}
it('queues quantity changes before group reprices and preserves the clamped quantity', () => {
  const s = setup();
  s.actions.updateQuantity('a', 3.9);
  expect(s.calls).toEqual(['quantity', 'reprice:a', 'reprice:b']);
  expect(s.shared.repriceLine.mock.calls[0][0].quantity).toBe(3);
  expect(s.active.current).toBe(false);
});
it('excludes the removed target from reprices so its server line remains live for removal', () => {
  const s = setup();
  s.actions.removeFromCart('a');
  expect(s.calls).toEqual(['reprice:b', 'remove']);
});
it('replaces a group deal with an individual price only after clearing other negotiated lines', () => {
  const s = setup();
  s.actions.applyNegotiatedPrice('a', 85);
  expect(s.calls).toEqual(['reprice:b', 'reprice:a']);
  expect(s.shared.repriceLine).toHaveBeenLastCalledWith(s.shared.cart[0], 85);
});
it('keeps the group deal when the matching line is already at the quantity cap', () => {
  const s = setup();
  s.shared.cart.push({
    ...s.shared.cart[0],
    id: 'capped',
    cartItemId: 'c',
    quantity: 10,
    negotiatedPrice: undefined,
    negotiationStatus: undefined,
  });
  const accepted = s.actions.addToCart(
    { id: 'capped', manage_stock: false, stock: 10 } as never,
    1
  );
  expect(accepted).toBe(false);
  expect(s.shared.addToCart).not.toHaveBeenCalled();
  expect(s.shared.repriceLine).not.toHaveBeenCalled();
  expect(s.active.current).toBe(true);
});
it('still voids the group deal for an add below the cap', () => {
  const s = setup();
  s.actions.addToCart(
    { id: 'new', manage_stock: false, stock: 10 } as never,
    1
  );
  expect(s.shared.addToCart).toHaveBeenCalledOnce();
  expect(s.calls).toEqual(['reprice:a', 'reprice:b']);
  expect(s.active.current).toBe(false);
});
it('keeps the group deal when its own negotiated line is at the cap after the void', () => {
  const s = setup();
  s.shared.cart[0].quantity = 10;
  const accepted = s.actions.addToCart(
    { id: 'p', manage_stock: false, stock: 10 } as never,
    1
  );
  expect(accepted).toBe(false);
  expect(s.shared.addToCart).not.toHaveBeenCalled();
  expect(s.shared.repriceLine).not.toHaveBeenCalled();
  expect(s.active.current).toBe(true);
});
it('routes clearing to canonical state and clears the local group flag', () => {
  const s = setup();
  s.actions.clearCart();
  expect(s.shared.clearCart).toHaveBeenCalledOnce();
  expect(s.active.current).toBe(false);
});
