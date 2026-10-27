import { renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { saveCartToStorage } from './cart-storage';
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
  fetchSharedCartProducts: vi.fn(),
  fetchSharedCartSnapshot: vi.fn(),
  sendSharedCartCommand: vi.fn(),
}));
it('adopts another tab’s preserved live session after a definitive bootstrap-scope rejection', async () => {
  window.localStorage.clear();
  saveCartToStorage([cartItem()], SLUG);
  vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  vi.mocked(fetchSharedCartSnapshot)
    .mockResolvedValueOnce({
      ok: false,
      code: 'unauthorized',
      retryable: false,
      snapshot: null,
    })
    .mockResolvedValue({
      ok: true,
      snapshot: snapshot({ lines: [] }),
      warnings: [],
    });
  vi.mocked(bootstrapSharedCart).mockResolvedValue({ ok: true });
  vi.mocked(createSharedCart).mockResolvedValue({
    ok: false,
    code: 'unauthorized',
    retryable: false,
    snapshot: null,
  });
  vi.mocked(sendSharedCartCommand).mockResolvedValue({
    ok: true,
    snapshot: snapshot({ version: 7 }),
    warnings: [],
    replayed: false,
  });
  const { result } = renderHook(() =>
    useSharedCart({
      merchantId: MERCHANT_ID,
      merchantSlug: SLUG,
      sessionGeneration: 1,
    })
  );
  await waitFor(() => expect(result.current.importStatus).toBe('done'));
  expect(createSharedCart).toHaveBeenCalledOnce();
  expect(sendSharedCartCommand).toHaveBeenCalledOnce();
  expect(result.current.cart).toHaveLength(1);
});
