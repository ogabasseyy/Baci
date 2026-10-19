import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveCartToStorage } from './cart-storage';
import {
  bootstrapSharedCart,
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
  product,
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

describe('useSharedCart legacy import failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  });

  it('surfaces a fatal creation failure without parking the queue', async () => {
    vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
      code: 'unauthorized',
      ok: false,
      retryable: false,
      snapshot: null,
    });
    vi.mocked(bootstrapSharedCart).mockResolvedValue({ ok: true });
    vi.mocked(createSharedCart)
      .mockResolvedValueOnce({
        code: 'unauthorized',
        ok: false,
        retryable: false,
        snapshot: null,
      })
      .mockResolvedValue({
        ok: true,
        replayed: false,
        snapshot: snapshot({ lines: [], version: 1 }),
        warnings: [],
      });
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({
        lines: [cartLine({ id: 'line-9', item: { productId: 'prod-9' } })],
        version: 2,
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
    await waitFor(() =>
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1)
    );

    await act(async () => {
      result.current.addToCart(product({ id: 'prod-9' }), 1);
    });

    await waitFor(() => expect(result.current.syncStatus).toBe('error'));
    expect(result.current.syncError).toBe('unauthorized');

    // The failed intent is dropped, so a fresh action retries creation.
    // The stable operation key is reused, which is replay-safe: the first
    // attempt left no cart behind.
    await act(async () => {
      result.current.addToCart(product({ id: 'prod-9' }), 1);
    });
    await waitFor(() =>
      expect(vi.mocked(createSharedCart)).toHaveBeenCalledTimes(2)
    );
    await waitFor(() => expect(result.current.syncStatus).toBe('synced'));
  });

  it('recovers the first action when bootstrap fails transiently', async () => {
    vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
      code: 'unauthorized',
      ok: false,
      retryable: false,
      snapshot: null,
    });
    vi.mocked(bootstrapSharedCart)
      .mockResolvedValueOnce({
        code: 'temporarily_unavailable',
        ok: false,
        retryable: true,
      })
      .mockResolvedValue({ ok: true });
    vi.mocked(createSharedCart).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({ lines: [], version: 1 }),
      warnings: [],
    });
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({
        lines: [cartLine({ id: 'line-9', item: { productId: 'prod-9' } })],
        version: 2,
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
    await waitFor(() =>
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1)
    );

    await act(async () => {
      result.current.addToCart(product({ id: 'prod-9' }), 1);
    });

    await waitFor(() => expect(result.current.syncStatus).toBe('retrying'));
    expect(bootstrapSharedCart).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.retryPendingSync();
    });
    await waitFor(() =>
      expect(vi.mocked(bootstrapSharedCart)).toHaveBeenCalledTimes(2)
    );
    await waitFor(() => expect(result.current.syncStatus).toBe('synced'));
  });

  it('merges into a nonempty adopted cart ahead of user actions', async () => {
    saveCartToStorage(
      [
        cartItem({ cartItemId: 'prod-1', id: 'prod-1', quantity: 3 }),
        cartItem({ cartItemId: 'prod-9', id: 'prod-9', quantity: 1 }),
      ],
      SLUG
    );
    mockAdopted();
    const firstImport = {
      ok: true as const,
      replayed: false,
      snapshot: snapshot({
        lines: [
          cartLine({
            id: 'line-9',
            item: { productId: 'prod-9' },
            quantity: 1,
          }),
          cartLine({ lineTotalMinor: 10000, quantity: 1 }),
        ],
        version: 4,
      }),
      warnings: [],
    };
    const secondImport = {
      ok: true as const,
      replayed: false,
      snapshot: snapshot({
        lines: [
          cartLine({
            id: 'line-9',
            item: { productId: 'prod-9' },
            quantity: 1,
          }),
          cartLine({ lineTotalMinor: 30000, quantity: 3 }),
        ],
        version: 5,
      }),
      warnings: [],
    };
    const userResponse = {
      ok: true as const,
      replayed: false,
      snapshot: snapshot({
        lines: [
          cartLine({
            id: 'line-9',
            item: { productId: 'prod-9' },
            quantity: 1,
          }),
          cartLine({ lineTotalMinor: 30000, quantity: 3 }),
          cartLine({
            id: 'line-user',
            item: { productId: 'prod-user' },
            quantity: 1,
          }),
        ],
        version: 6,
      }),
      warnings: [],
    };
    vi.mocked(sendSharedCartCommand)
      .mockResolvedValueOnce(firstImport)
      .mockResolvedValueOnce(secondImport)
      .mockResolvedValueOnce(userResponse);

    const { result } = renderHook(() =>
      useSharedCart({
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );
    await waitFor(() => expect(result.current.cartId).toBe(CART_ID));

    // A user action during the import still sends after the import block.
    await act(async () => {
      result.current.addToCart(product({ id: 'prod-user' }), 1);
    });
    await waitFor(() =>
      expect(vi.mocked(sendSharedCartCommand)).toHaveBeenCalledTimes(3)
    );

    const calls = vi.mocked(sendSharedCartCommand).mock.calls;
    expect(calls[0]?.[0]).toMatchObject({
      command: { item: { productId: 'prod-9' }, type: 'add' },
      operationId: expect.stringMatching(/^import:/),
    });
    expect(calls[1]?.[0]).toMatchObject({
      command: { lineId: 'line-1', quantity: 3, type: 'set_quantity' },
    });
    expect(calls[2]?.[0]).toMatchObject({
      command: { item: { productId: 'prod-user' }, type: 'add' },
    });
    expect(calls[2]?.[0]?.operationId).not.toMatch(/^import:/);
    await waitFor(() => expect(result.current.importStatus).toBe('done'));
  });
});
