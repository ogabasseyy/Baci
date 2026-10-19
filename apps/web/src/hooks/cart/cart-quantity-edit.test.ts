import { describe, expect, it } from 'vitest';
import {
  applyStorefrontCartQuantityEdit,
  findQuantityEditTargetIndex,
  probeQuantityEditApplied,
} from './cart-quantity-edit';
import type { CartItem } from './cart-types';

const line = {
  id: 'prod-1',
  cartItemId: 'line-1',
  quantity: 1,
} as CartItem;

describe('cart-quantity-edit', () => {
  it('targets by variant id, cart item id, or variant-less product id', () => {
    const cart = [
      { ...line, variantId: 'v-1' },
      { ...line, id: 'prod-2', cartItemId: 'line-2' },
    ];
    expect(findQuantityEditTargetIndex(cart, 'prod-1', 'v-1')).toBe(0);
    expect(findQuantityEditTargetIndex(cart, 'line-2')).toBe(1);
    expect(findQuantityEditTargetIndex(cart, 'prod-2')).toBe(1);
    expect(findQuantityEditTargetIndex(cart, 'missing')).toBe(-1);
  });

  it('probes removals and missing targets without consulting caps', () => {
    expect(
      probeQuantityEditApplied({
        cart: [line],
        cartItemIdOrProductId: 'line-1',
        quantity: 0,
      })
    ).toBe(true);
    expect(
      probeQuantityEditApplied({
        cart: [line],
        cartItemIdOrProductId: 'missing',
        quantity: 2,
      })
    ).toBe(false);
  });

  it('removes the line at zero and clears the group deal', () => {
    const negotiated = {
      ...line,
      negotiatedPrice: 50,
      negotiationStatus: 'accepted',
    } as CartItem;
    const next = applyStorefrontCartQuantityEdit({
      previousCart: [negotiated],
      cartItemIdOrProductId: 'line-1',
      quantity: 0,
      wasGroupActive: true,
    });
    expect(next).toEqual([]);
  });

  it('keeps the previous cart for a missing target or a capped edit', () => {
    const cart = [line];
    expect(
      applyStorefrontCartQuantityEdit({
        previousCart: cart,
        cartItemIdOrProductId: 'missing',
        quantity: 2,
        wasGroupActive: true,
      })
    ).toBe(cart);
  });

  it('applies a plain quantity change and resets group pricing', () => {
    const negotiated = {
      ...line,
      negotiatedPrice: 50,
      negotiationStatus: 'accepted',
    } as CartItem;
    const next = applyStorefrontCartQuantityEdit({
      previousCart: [negotiated],
      cartItemIdOrProductId: 'line-1',
      quantity: 3,
      wasGroupActive: true,
    });
    expect(next[0].quantity).toBe(3);
    expect(next[0].negotiatedPrice).toBeUndefined();
  });
});
