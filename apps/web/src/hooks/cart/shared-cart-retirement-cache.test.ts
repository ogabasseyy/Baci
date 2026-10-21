import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
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

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));
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

it('clears parked cache before passive revocation releases replacement-session access', async () => {
  vi.clearAllMocks();
  resetPendingCartDeviceRevocationsForTests();
  const real = await vi.importActual<
    typeof import('./shared-cart-session-revoke-client')
  >('./shared-cart-session-revoke-client');
  saveCartToStorage([cartItem({ name: 'Previous account item' })], SLUG);
  saveCartToStorage([cartItem({ name: 'Other merchant item' })], 'other-shop');
  markCartDeviceRevocationPending(SLUG);
  vi.mocked(fetchWithCsrf).mockResolvedValue(
    new Response(JSON.stringify({ revoked: true }), { status: 200 })
  );
  await expect(real.ensureCartDeviceRevocationCleared(SLUG)).resolves.toBe(
    true
  );
  expect(getCartFromStorage(SLUG)).toEqual([]);
  expect(getCartFromStorage('other-shop')).toHaveLength(1);
});

it('retains the parked cache and fence when passive revocation fails', async () => {
  const real = await vi.importActual<
    typeof import('./shared-cart-session-revoke-client')
  >('./shared-cart-session-revoke-client');
  saveCartToStorage([cartItem({ name: 'Previous account item' })], SLUG);
  markCartDeviceRevocationPending(SLUG);
  vi.mocked(fetchWithCsrf).mockResolvedValue(
    new Response(JSON.stringify({ code: 'temporarily_unavailable' }), {
      status: 503,
    })
  );
  await expect(real.ensureCartDeviceRevocationCleared(SLUG)).resolves.toBe(
    false
  );
  expect(real.isCartDeviceRevocationPending(SLUG)).toBe(true);
  expect(getCartFromStorage(SLUG)).toHaveLength(1);
});

it('defers cache erasure when the caller must commit first', async () => {
  const real = await vi.importActual<
    typeof import('./shared-cart-session-revoke-client')
  >('./shared-cart-session-revoke-client');
  saveCartToStorage([cartItem({ name: 'Saved device item' })], SLUG);
  markCartDeviceRevocationPending(SLUG);
  vi.mocked(fetchWithCsrf).mockResolvedValue(
    new Response(JSON.stringify({ revoked: true }), { status: 200 })
  );
  await expect(
    real.revokeCartDeviceSession(SLUG, { deferCacheErasure: true })
  ).resolves.toEqual({ ok: true });
  expect(getCartFromStorage(SLUG)).toHaveLength(1);
  expect(real.isCartDeviceRevocationPending(SLUG)).toBe(false);
});

it('keeps the fence when restricted storage prevents removing the retired cache', async () => {
  const real = await vi.importActual<
    typeof import('./shared-cart-session-revoke-client')
  >('./shared-cart-session-revoke-client');
  saveCartToStorage([cartItem()], SLUG);
  markCartDeviceRevocationPending(SLUG);
  vi.mocked(fetchWithCsrf).mockResolvedValue(
    new Response(JSON.stringify({ revoked: true }), { status: 200 })
  );
  const original = Storage.prototype.removeItem;
  const removal = vi
    .spyOn(Storage.prototype, 'removeItem')
    .mockImplementation(function (this: Storage, key: string) {
      if (key === 'baci-cart-ogabassey-guest')
        throw new Error('storage denied');
      original.call(this, key);
    });
  try {
    await expect(real.ensureCartDeviceRevocationCleared(SLUG)).resolves.toBe(
      false
    );
    expect(real.isCartDeviceRevocationPending(SLUG)).toBe(true);
    expect(getCartFromStorage(SLUG)).toHaveLength(1);
  } finally {
    removal.mockRestore();
  }
});
