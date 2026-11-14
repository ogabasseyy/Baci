import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { cleanupOxygenCompletedCheckout } from '@/components/payments/oxygen/oxygen-checkout-cleanup';
import { captureOxygenCheckoutSnapshot } from '@/components/payments/oxygen/oxygen-checkout-snapshot';
import { useCart } from './cart-context';
import {
  getCartFromStorage,
  getStorefrontCartStorageKey,
} from './cart-storage';
import { StorefrontCartProvider } from './storefront-cart-provider';

vi.mock('./use-legacy-cart-validation', () => ({
  useLegacyCartValidation: () => {},
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
const pending = {
  orderId: 'order',
  merchantId: 'merchant',
  paymentMethod: 'oxygen',
  checkoutFingerprint: 'test-fingerprint',
};
const storedLine = {
  id: 'phone',
  name: 'Phone',
  price: 100,
  quantity: 1,
  cartItemId: 'phone',
};
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
it('assigns and persists legacy IDs at hydration so a future order can remove its purchased line', async () => {
  localStorage.setItem(
    getStorefrontCartStorageKey('shop'),
    JSON.stringify([storedLine])
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StorefrontCartProvider merchantSlug="shop" deferValidationUntilIdle>
      {children}
    </StorefrontCartProvider>
  );
  const { result } = renderHook(() => useCart(), { wrapper });
  await waitFor(() =>
    expect(result.current.cart[0]?.cartLineInstanceId).toBeTruthy()
  );
  const instance = result.current.cart[0].cartLineInstanceId;
  await waitFor(() =>
    expect(
      JSON.parse(
        localStorage.getItem(getStorefrontCartStorageKey('shop')) || '[]'
      )[0].cartLineInstanceId
    ).toBe(instance)
  );
  expect(getCartFromStorage('shop')[0].cartLineInstanceId).toBe(instance);
  expect(getCartFromStorage('shop')[0].cartLineInstanceId).toBe(instance);
  sessionStorage.setItem(
    'storefront-checkout-pending-order',
    JSON.stringify(pending)
  );
  captureOxygenCheckoutSnapshot('order', 'merchant', result.current.cart);
  await act(async () =>
    cleanupOxygenCompletedCheckout('order', 'merchant', {
      merchantSlug: 'shop',
      cart: result.current,
    })
  );
  await waitFor(() => expect(result.current.cart).toHaveLength(0));
});
it('keeps old snapshots without IDs conservative and adopts a different merchant on switch', async () => {
  localStorage.setItem(
    getStorefrontCartStorageKey('shop'),
    JSON.stringify([storedLine])
  );
  localStorage.setItem(
    getStorefrontCartStorageKey('second'),
    JSON.stringify([{ ...storedLine, id: 'other', cartItemId: 'other' }])
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StorefrontCartProvider merchantSlug="shop" deferValidationUntilIdle>
      {children}
    </StorefrontCartProvider>
  );
  const { result } = renderHook(() => useCart(), { wrapper });
  await waitFor(() =>
    expect(result.current.cart[0]?.cartLineInstanceId).toBeTruthy()
  );
  sessionStorage.setItem(
    'storefront-checkout-pending-order',
    JSON.stringify(pending)
  );
  captureOxygenCheckoutSnapshot('order', 'merchant', [storedLine]);
  await act(async () =>
    cleanupOxygenCompletedCheckout('order', 'merchant', {
      merchantSlug: 'shop',
      cart: result.current,
    })
  );
  expect(result.current.cart).toHaveLength(1);
  act(() => result.current.setMerchantSlug('second'));
  await waitFor(() => expect(result.current.cart[0]?.id).toBe('other'));
  await waitFor(() =>
    expect(result.current.cart[0]?.cartLineInstanceId).toBeTruthy()
  );
  const secondId = result.current.cart[0].cartLineInstanceId;
  await waitFor(() =>
    expect(
      JSON.parse(
        localStorage.getItem(getStorefrontCartStorageKey('second')) || '[]'
      )[0].cartLineInstanceId
    ).toBe(secondId)
  );
});
it('does not adopt delegated or server-owned lines', async () => {
  const { useLegacyCartInstanceAdoption } = await import(
    './use-legacy-cart-instance-adoption'
  );
  const update = vi.fn();
  const serverLine = { ...storedLine, serverLineId: 'server-line' };
  const { rerender } = renderHook(
    ({ enabled }) =>
      useLegacyCartInstanceAdoption([serverLine] as never, enabled, update),
    { initialProps: { enabled: false } }
  );
  expect(update).not.toHaveBeenCalled();
  rerender({ enabled: true });
  expect(update).not.toHaveBeenCalled();
});
