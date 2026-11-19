import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { getStorefrontCartStorageKey } from './cart-storage';
import { useStorefrontCartSessionHandlers } from './use-storefront-cart-session-handlers';

const cart = [
  {
    id: 'phone',
    name: 'Phone',
    price: 100,
    quantity: 2,
    cartItemId: 'phone',
    cartLineInstanceId: 'one',
  },
];
const purchased = [{ cartItemId: 'phone', instanceId: 'one', quantity: 1 }];
function setup(delegated: boolean, currentCart = cart) {
  const setCart = vi.fn();
  const cartRef = { current: currentCart };
  const { result } = renderHook(() =>
    useStorefrontCartSessionHandlers({
      bumpSessionGeneration: vi.fn(),
      cartWideNegotiationActive: false,
      cartRef,
      delegated,
      delegatedActions: { clearCart: vi.fn() },
      initialMerchantSlug: 'shop',
      merchantId: 'merchant',
      merchantSlug: 'shop',
      merchantSlugRef: { current: 'shop' },
      setCart,
      setCartWideNegotiationActive: vi.fn(),
      setIsHydrated: vi.fn(),
      setMerchantSlugState: vi.fn(),
      sharedCartEnabled: delegated,
    } as never)
  );
  return { result, setCart, cartRef };
}
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    getStorefrontCartStorageKey('shop'),
    JSON.stringify(cart)
  );
});
it('does not subtract again after a second tab reloads the remaining quantity', () => {
  const first = setup(false);
  first.result.current.completeOxygenPurchasedLines('shop', purchased);
  const updated = [{ ...first.cartRef.current[0], quantity: 2 }];
  localStorage.setItem(
    getStorefrontCartStorageKey('shop'),
    JSON.stringify(updated)
  );
  const second = setup(false, updated);
  second.result.current.completeOxygenPurchasedLines('shop', purchased);
  expect(second.setCart).not.toHaveBeenCalled();
  expect(second.cartRef.current[0].quantity).toBe(2);
});
it('uses a functional local cart update to preserve added quantities', () => {
  const { result, setCart, cartRef } = setup(false);
  result.current.completeOxygenPurchasedLines('shop', purchased);
  expect(setCart).toHaveBeenCalledOnce();
  const updater = setCart.mock.calls[0][0];
  expect(updater(cart)[0].quantity).toBe(1);
  expect(updater(cart)[0].cartLineInstanceId).not.toBe('one');
  expect(updater(cart)[0].cartLineInstanceId).toBe(
    cartRef.current[0].cartLineInstanceId
  );
});
it('does not touch shared carts or overwrite a newer stored cart', () => {
  const shared = setup(true);
  shared.result.current.completeOxygenPurchasedLines('shop', purchased);
  expect(shared.setCart).not.toHaveBeenCalled();
  const local = setup(false);
  localStorage.setItem(
    getStorefrontCartStorageKey('shop'),
    JSON.stringify([...cart, { ...cart[0], id: 'new', cartItemId: 'new' }])
  );
  local.result.current.completeOxygenPurchasedLines('shop', purchased);
  expect(local.setCart).not.toHaveBeenCalled();
});
