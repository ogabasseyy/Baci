import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveCartToStorage } from './cart-storage';
import {
  createSharedCart,
  fetchSharedCartProducts,
  fetchSharedCartSnapshot,
  sendSharedCartCommand,
} from './shared-cart-client';
import {
  CART_ID,
  cartItem,
  cartLine,
  MERCHANT_ID,
  mockAdopted,
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

describe('useSharedCart legacy import conflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  });

  it('holds conflicting attachments for explicit resolution', async () => {
    saveCartToStorage(
      [
        cartItem({
          cartItemId: 'prod-1',
          id: 'prod-1',
          quantity: 1,
          quizAwardId: 'award-1',
          quizVoucherToken: 'token-1',
        }),
      ],
      SLUG
    );
    mockAdopted();

    const { result } = renderHook(() =>
      useSharedCart({
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );

    await waitFor(() => expect(result.current.importStatus).toBe('failed'));
    expect(result.current.importConflicts).toHaveLength(1);
    expect(vi.mocked(sendSharedCartCommand)).not.toHaveBeenCalled();
    // The server cart stays authoritative; nothing local is applied.
    expect(result.current.cart.map((line) => line.id)).toEqual(['prod-1']);
  });

  it('skips the import when the cache is empty or already imported', async () => {
    const { saveSharedCartImportReceipt } = await import('./cart-storage');
    saveSharedCartImportReceipt(SLUG, {
      cartId: CART_ID,
      importedAt: '2026-10-12T08:00:00.000Z',
      lineCount: 1,
    });
    saveCartToStorage([cartItem({ id: 'prod-9' })], SLUG);
    mockAdopted();

    const { result } = renderHook(() =>
      useSharedCart({
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );

    await waitFor(() => expect(result.current.importStatus).toBe('done'));
    expect(vi.mocked(sendSharedCartCommand)).not.toHaveBeenCalled();
    expect(vi.mocked(createSharedCart)).not.toHaveBeenCalled();
  });

  it('retries a failed import explicitly without duplicating committed lines', async () => {
    saveCartToStorage(
      [cartItem({ cartItemId: 'prod-9', id: 'prod-9', quantity: 1 })],
      SLUG
    );
    mockAdopted(3, []);
    vi.mocked(sendSharedCartCommand)
      .mockResolvedValueOnce({
        code: 'invalid_item',
        ok: false,
        retryable: false,
        snapshot: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        replayed: false,
        snapshot: snapshot({
          lines: [
            cartLine({
              id: 'line-9',
              item: { productId: 'prod-9' },
              quantity: 1,
            }),
          ],
          // Newer than the adopted v3 empty cart: stale snapshots are ignored.
          version: 4,
        }),
        warnings: [],
      });

    const { result } = renderHook(() =>
      useSharedCart({
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );

    await waitFor(() => expect(result.current.importStatus).toBe('failed'));
    expect(result.current.cart).toHaveLength(0);

    await act(async () => {
      result.current.retryImport();
    });
    await waitFor(() => expect(result.current.importStatus).toBe('done'));
    const calls = vi.mocked(sendSharedCartCommand).mock.calls;
    expect(calls).toHaveLength(2);
    // Same derived key: a committed-then-lost first attempt replays.
    expect(calls[1]?.[0]?.operationId).toBe(calls[0]?.[0]?.operationId);
    expect(result.current.cart.map((line) => line.id)).toEqual(['prod-9']);
  });

  it('fails the import when conflicts exhaust the retry cap', async () => {
    saveCartToStorage(
      [cartItem({ cartItemId: 'prod-9', id: 'prod-9', quantity: 1 })],
      SLUG
    );
    mockAdopted(3, [cartLine()]);
    // Every conflict carries no cart, so each attempt refetches the same
    // adopted snapshot and requeues with the original key — until the
    // reducer drops the entry past its conflict cap.
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      code: 'version_conflict',
      ok: false,
      retryable: true,
      snapshot: null,
    });

    const { result } = renderHook(() =>
      useSharedCart({
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );

    await waitFor(() => expect(result.current.importStatus).toBe('failed'));
    expect(result.current.syncError).toBe('version_conflict');
    // Original key preserved across all capped attempts.
    const calls = vi.mocked(sendSharedCartCommand).mock.calls;
    expect(calls).toHaveLength(4);
    expect(calls[0]?.[0]?.operationId).toMatch(/^import:/);
    for (const call of calls) {
      expect(call[0]?.operationId).toBe(calls[0]?.[0]?.operationId);
    }
  });

  it('fails the import when the conflict refetch fails fatally', async () => {
    saveCartToStorage(
      [cartItem({ cartItemId: 'prod-9', id: 'prod-9', quantity: 1 })],
      SLUG
    );
    vi.mocked(fetchSharedCartSnapshot)
      .mockResolvedValueOnce({
        ok: true,
        snapshot: snapshot({ lines: [cartLine()], version: 3 }),
        warnings: [],
      })
      .mockResolvedValue({
        code: 'not_found',
        ok: false,
        retryable: false,
        snapshot: null,
      });
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      code: 'version_conflict',
      ok: false,
      retryable: true,
      snapshot: null,
    });

    const { result } = renderHook(() =>
      useSharedCart({
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );

    await waitFor(() => expect(result.current.importStatus).toBe('failed'));
    expect(result.current.syncError).toBe('not_found');
  });
});
