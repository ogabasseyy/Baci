import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { getSharedCartImportReceipt, saveCartToStorage } from './cart-storage';
import { bootstrapSharedCart, createSharedCart } from './shared-cart-client';
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
it('re-plans preserved device lines into the next cart after a polled terminal adoption', async () => {
  const preserved = cartItem({ id: 'prod-9', cartItemId: 'prod-9' });
  saveCartToStorage([preserved], SLUG);
  const newCart = snapshot({
    cartId: '33333333-3333-4333-8333-333333333333',
    lines: [cartLine({ id: 'line-9', item: { productId: 'prod-9' } })],
    version: 1,
  });
  vi.mocked(createSharedCart).mockResolvedValue({
    ok: true,
    replayed: false,
    snapshot: newCart,
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
  const terminal = snapshot({ state: 'completed', lines: [], version: 9 });
  runtime.stateRef.current = {
    ...runtime.stateRef.current,
    cartId: CART_ID,
    confirmed: terminal,
    display: [preserved],
    generation: 7,
    importStatus: 'skipped',
    unimportedCache: [preserved],
  };
  runtime.adoptOutcomeRef.current = 'session';
  runtime.retiredCartIdRef.current = null;
  runtime.createRequestRef.current = null;
  runtime.createAttemptedRef.current = false;
  const provisioning = createCartProvisioning(runtime);
  await expect(provisioning.ensureCart()).resolves.toEqual({ ok: true });
  expect(createSharedCart).toHaveBeenCalledWith(
    expect.objectContaining({
      lines: [
        expect.objectContaining({
          item: expect.objectContaining({ productId: 'prod-9' }),
        }),
      ],
    }),
    SLUG
  );
  expect(getSharedCartImportReceipt(SLUG)?.cartId).toBe(newCart.cartId);
});
