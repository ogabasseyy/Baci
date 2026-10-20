import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { getCartFromStorage, saveCartToStorage } from './cart-storage';
import { fetchSharedCartSnapshot } from './shared-cart-client';
import {
  cartItem,
  MERCHANT_ID,
  SLUG,
} from './shared-cart-provisioning.test-support';
import {
  ensureCartDeviceRevocationCleared,
  markCartDeviceRevocationPending,
  resetPendingCartDeviceRevocationsForTests,
} from './shared-cart-session-revoke-client';
import { useSharedCart } from './use-shared-cart';

vi.mock('./shared-cart-client', () => ({
  fetchSharedCartSnapshot: vi.fn(),
  createSharedCart: vi.fn(),
  bootstrapSharedCart: vi.fn(),
  fetchSharedCartProducts: vi.fn(),
  sendSharedCartCommand: vi.fn(),
}));
vi.mock('./shared-cart-session-revoke-client', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('./shared-cart-session-revoke-client')
  >()),
  ensureCartDeviceRevocationCleared: vi.fn().mockResolvedValue(false),
}));
afterEach(() => {
  resetPendingCartDeviceRevocationsForTests();
  window.localStorage.clear();
});
it('parks saved items without exposing them while account retirement is unresolved', async () => {
  window.localStorage.clear();
  resetPendingCartDeviceRevocationsForTests();
  saveCartToStorage([cartItem({ name: 'Previous account item' })], SLUG);
  markCartDeviceRevocationPending(SLUG);
  const { result } = renderHook(() =>
    useSharedCart({
      merchantId: MERCHANT_ID,
      merchantSlug: SLUG,
      sessionGeneration: 1,
    })
  );
  await waitFor(() =>
    expect(ensureCartDeviceRevocationCleared).toHaveBeenCalled()
  );
  expect(result.current.cart).toHaveLength(0);
  expect(getCartFromStorage(SLUG)).toHaveLength(1);
  expect(fetchSharedCartSnapshot).not.toHaveBeenCalled();
});
