import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveCartToStorage } from './cart-storage';
import {
  bootstrapSharedCart,
  createSharedCart,
  fetchSharedCartProducts,
  fetchSharedCartSnapshot,
} from './shared-cart-client';
import {
  CART_ID,
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
describe('initial device cart recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it.each([
    'retry',
    'retry-sync',
    'discard',
  ] as const)('offers %s for an oversized saved cart without another edit', async (action) => {
    saveCartToStorage(
      Array.from({ length: 21 }, (_, index) =>
        cartItem({
          id: `prod-${index}`,
          cartItemId: `prod-${index}`,
        })
      ),
      SLUG
    );
    vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
      code: 'unauthorized',
      ok: false,
      retryable: false,
      snapshot: null,
    });
    vi.mocked(bootstrapSharedCart).mockResolvedValue({ ok: true });
    vi.mocked(createSharedCart).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot(),
      warnings: [],
    });
    if (action === 'retry-sync') {
      vi.mocked(createSharedCart).mockResolvedValueOnce({
        ok: false,
        code: 'temporarily_unavailable',
        retryable: true,
        snapshot: null,
      });
    }
    const { result } = renderHook(() =>
      useSharedCart({
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );
    await waitFor(() =>
      expect(result.current.importWarnings).toContain(
        'import_capacity_exceeded'
      )
    );
    expect(createSharedCart).not.toHaveBeenCalled();
    expect(result.current.importStatus).toBe('failed');
    if (action === 'discard') {
      act(() => result.current.discardLegacyImport());
      expect(result.current.importStatus).toBe('skipped');
      expect(result.current.cart).toEqual([]);
      expect(createSharedCart).not.toHaveBeenCalled();
    } else {
      saveCartToStorage([cartItem()], SLUG);
      act(() => result.current.retryImport());
      if (action === 'retry-sync') {
        await waitFor(() =>
          expect(result.current.syncError).toBe('temporarily_unavailable')
        );
        act(() => result.current.discardLegacyImport());
        expect(result.current.importStatus).toBe('failed');
        act(() => result.current.retryPendingSync());
      }
      await waitFor(() => expect(result.current.importStatus).toBe('done'));
      expect(result.current.cartId).toBe(CART_ID);
    }
  });
});
