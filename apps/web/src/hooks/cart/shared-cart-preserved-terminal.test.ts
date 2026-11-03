import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { saveCartToStorage } from './cart-storage';
import {
  bootstrapSharedCart,
  createSharedCart,
  fetchSharedCartSnapshot,
} from './shared-cart-client';
import { createCartProvisioning } from './shared-cart-provisioning';
import {
  CART_ID,
  cartItem,
  cartLine,
  MERCHANT_ID,
  SLUG,
  snapshot,
} from './shared-cart-provisioning.test-support';
import { useSharedCartRuntime } from './use-shared-cart-runtime';

vi.mock('./shared-cart-client', () => ({
  bootstrapSharedCart: vi.fn(),
  createSharedCart: vi.fn(),
  fetchSharedCartProducts: vi.fn(),
  fetchSharedCartSnapshot: vi.fn(),
  sendSharedCartCommand: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(bootstrapSharedCart).mockResolvedValue({ ok: true });
});
it('retires an already-terminal preserved session and provisions a fresh cart', async () => {
  saveCartToStorage([cartItem({ id: 'prod-9', cartItemId: 'prod-9' })], SLUG);
  const terminal = snapshot({ state: 'completed', lines: [], version: 9 });
  const fresh = snapshot({
    cartId: '33333333-3333-4333-8333-333333333333',
    lines: [cartLine({ id: 'line-9', item: { productId: 'prod-9' } })],
    version: 1,
  });
  vi.mocked(createSharedCart)
    .mockResolvedValueOnce({
      ok: false,
      code: 'unauthorized',
      retryable: false,
      snapshot: null,
    })
    .mockResolvedValueOnce({
      ok: true,
      replayed: false,
      snapshot: fresh,
      warnings: [],
    });
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: true,
    snapshot: terminal,
    warnings: [],
  });
  const { result } = renderHook(() =>
    useSharedCartRuntime({
      merchantId: MERCHANT_ID,
      merchantSlug: SLUG,
      sessionGeneration: 7,
    })
  );
  const runtime = result.current;
  runtime.adoptOutcomeRef.current = 'bootstrap';
  const provisioning = createCartProvisioning(runtime);
  await expect(provisioning.ensureCart()).resolves.toEqual({ ok: true });
  expect(createSharedCart).toHaveBeenCalledTimes(2);
  expect(runtime.retiredCartIdRef.current).toBe(CART_ID);
});
