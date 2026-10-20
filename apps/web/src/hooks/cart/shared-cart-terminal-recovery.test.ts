import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { getCartFromStorage, saveCartToStorage } from './cart-storage';
import {
  bootstrapSharedCart,
  createSharedCart,
  fetchSharedCartProducts,
  fetchSharedCartSnapshot,
  sendSharedCartCommand,
} from './shared-cart-client';
import {
  cartItem,
  MERCHANT_ID,
  SLUG,
  snapshot,
} from './shared-cart-provisioning.test-support';
import { useSharedCart } from './use-shared-cart';

vi.mock('./shared-cart-client', () => ({
  bootstrapSharedCart: vi.fn(),
  createSharedCart: vi.fn(),
  fetchSharedCartSnapshot: vi.fn(),
  fetchSharedCartProducts: vi.fn(),
  sendSharedCartCommand: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});
it.each([
  'completed',
  'expired',
  'canceled',
])('provisions saved device lines after a %s snapshot', async (state) => {
  saveCartToStorage([cartItem()], SLUG);
  vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: true,
    snapshot: snapshot({ state, lines: [] }),
    warnings: [],
  });
  vi.mocked(bootstrapSharedCart).mockResolvedValue({ ok: true });
  let finish!: (result: Awaited<ReturnType<typeof createSharedCart>>) => void;
  vi.mocked(createSharedCart).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { result } = renderHook(() =>
    useSharedCart({
      merchantId: MERCHANT_ID,
      merchantSlug: SLUG,
      sessionGeneration: 1,
    })
  );
  await waitFor(() => expect(createSharedCart).toHaveBeenCalledOnce());
  expect(getCartFromStorage(SLUG)).toHaveLength(1);
  expect(vi.mocked(createSharedCart).mock.calls[0][0].lines).toHaveLength(1);
  finish({
    ok: true,
    replayed: false,
    snapshot: snapshot({ cartId: '33333333-3333-4333-8333-333333333333' }),
    warnings: [],
  });
  await waitFor(() => expect(result.current.importStatus).toBe('done'));
  expect(result.current.cart).toHaveLength(1);
  expect(sendSharedCartCommand).not.toHaveBeenCalled();
});
