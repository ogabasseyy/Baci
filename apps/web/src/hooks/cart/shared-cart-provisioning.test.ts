import type { CartLine, CartSnapshot } from '@baci/shared/cart';

import { act, renderHook, waitFor } from '@testing-library/react';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Product } from '@/lib/products';

import { saveCartToStorage } from './cart-storage';

import type { CartItem } from './cart-types';

import {
  bootstrapSharedCart,
  createSharedCart,
  fetchSharedCartProducts,
  fetchSharedCartSnapshot,
  sendSharedCartCommand,
} from './shared-cart-client';

import { useSharedCart } from './use-shared-cart';

vi.mock('./shared-cart-client', () => ({
  bootstrapSharedCart: vi.fn(),
  createSharedCart: vi.fn(),
  fetchSharedCartProducts: vi.fn(),
  fetchSharedCartSnapshot: vi.fn(),
  sendSharedCartCommand: vi.fn(),
}));

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

const SLUG = 'ogabassey';

const CART_ID = '22222222-2222-4222-8222-222222222222';

function product(overrides: Record<string, unknown> = {}): Product {
  return {
    brand: 'Brand',
    description: '',
    gtin: '',
    id: 'prod-1',
    image: '/prod-1.png',
    imageHint: 'product',
    imageLarge: '/prod-1-large.png',
    manage_stock: false,
    mpn: '',
    name: 'Phone',
    price: 100,
    slug: 'phone',
    status: 'active',
    stock: 10,
    ...overrides,
  } as Product;
}

function cartItem(overrides: Record<string, unknown> = {}): CartItem {
  return {
    ...product(),
    cartItemId: 'prod-1',
    quantity: 1,
    ...overrides,
  } as CartItem;
}

function cartLine(overrides: Record<string, unknown> = {}): CartLine {
  return {
    id: 'line-1',
    item: { productId: 'prod-1' },
    lineTotalMinor: 10000,
    quantity: 1,
    unitPriceMinor: 10000,
    ...overrides,
  } as CartLine;
}

function snapshot(overrides: Record<string, unknown> = {}): CartSnapshot {
  const lines = (overrides.lines as CartLine[] | undefined) ?? [cartLine()];
  const subtotalMinor = lines.reduce(
    (sum, line) => sum + line.lineTotalMinor,
    0
  );
  return {
    cartId: CART_ID,
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: '2026-10-19T04:00:00.000Z',
    lines,
    merchantId: MERCHANT_ID,
    state: 'active',
    subtotalMinor,
    totalMinor: subtotalMinor,
    version: 3,
    ...overrides,
  } as CartSnapshot;
}

function mockAdopted(version = 3, lines: CartLine[] = [cartLine()]) {
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: true,
    snapshot: snapshot({ lines, version }),
    warnings: [],
  });
}

describe('useSharedCart legacy import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  });

  it('keeps creation pending and retries its exact cached lines after an unknown outcome', async () => {
    saveCartToStorage([cartItem({ quantity: 2 })], SLUG);
    vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
      code: 'unauthorized',
      ok: false,
      retryable: false,
      snapshot: null,
    });
    vi.mocked(bootstrapSharedCart).mockResolvedValue({ ok: true });
    let finish: (value: Awaited<ReturnType<typeof createSharedCart>>) => void =
      () => undefined;
    vi.mocked(createSharedCart)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValue({
        ok: true,
        replayed: true,
        snapshot: snapshot({ version: 1 }),
        warnings: [],
      });
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({ version: 2 }),
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
    act(() => result.current.addToCart(product({ id: 'prod-9' }), 1));
    await waitFor(() => expect(createSharedCart).toHaveBeenCalledTimes(1));
    expect(result.current.importStatus).toBe('pending');
    expect(result.current.syncStatus).not.toBe('retrying');
    expect(result.current.syncError).toBeNull();
    await act(async () => {
      finish({
        ok: false,
        code: 'temporarily_unavailable',
        retryable: true,
        snapshot: null,
      });
    });
    await waitFor(() => expect(result.current.syncStatus).toBe('retrying'));
    saveCartToStorage([cartItem({ quantity: 7 })], SLUG);
    act(() => result.current.retryPendingSync());
    await waitFor(() => expect(createSharedCart).toHaveBeenCalledTimes(2));
    expect(vi.mocked(createSharedCart).mock.calls[1][0]).toEqual(
      vi.mocked(createSharedCart).mock.calls[0][0]
    );
    await waitFor(() => expect(result.current.importStatus).toBe('done'));
  });

  it('creates with the cached lines on the first action and records the receipt', async () => {
    saveCartToStorage(
      [cartItem({ id: 'prod-1', price: 100, quantity: 2 })],
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
      snapshot: snapshot({
        lines: [cartLine({ lineTotalMinor: 20000, quantity: 2 })],
        version: 1,
      }),
      warnings: [],
    });
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({
        lines: [
          cartLine({ lineTotalMinor: 20000, quantity: 2 }),
          cartLine({
            id: 'line-9',
            item: { productId: 'prod-9' },
            quantity: 1,
          }),
        ],
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

    await waitFor(() => expect(createSharedCart).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createSharedCart).mock.calls[0]?.[0]).toMatchObject({
      lines: [{ item: { productId: 'prod-1' }, quantity: 2 }],
      operationId: expect.stringMatching(/^import:/),
    });
    await waitFor(() => expect(result.current.importStatus).toBe('done'));
    // The user action sends after the import lands.
    await waitFor(() =>
      expect(vi.mocked(sendSharedCartCommand)).toHaveBeenCalledTimes(1)
    );
    // The receipt pins this cart as imported; the old cache key survives
    // until the receipt exists (it does now).
    const { getSharedCartImportReceipt } = await import('./cart-storage');
    expect(getSharedCartImportReceipt(SLUG)).toMatchObject({
      cartId: CART_ID,
      lineCount: 1,
    });
  });

  it('recovers the first action when cart creation fails transiently', async () => {
    vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
      code: 'unauthorized',
      ok: false,
      retryable: false,
      snapshot: null,
    });
    vi.mocked(bootstrapSharedCart).mockResolvedValue({ ok: true });
    vi.mocked(createSharedCart)
      .mockResolvedValueOnce({
        code: 'temporarily_unavailable',
        ok: false,
        retryable: true,
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

    // The transient failure surfaces on the head entry instead of
    // stalling it silently in the queue.
    await waitFor(() => expect(result.current.syncStatus).toBe('retrying'));
    expect(result.current.syncError).toBe('temporarily_unavailable');

    await act(async () => {
      result.current.retryPendingSync();
    });
    await waitFor(() =>
      expect(vi.mocked(createSharedCart)).toHaveBeenCalledTimes(2)
    );
    await waitFor(() =>
      expect(vi.mocked(sendSharedCartCommand)).toHaveBeenCalledTimes(1)
    );
    await waitFor(() => expect(result.current.syncStatus).toBe('synced'));
    expect(result.current.cart.map((line) => line.id)).toEqual(['prod-9']);
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
it('retires a completed cart and provisions empty before the next add', async () => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: true,
    snapshot: snapshot({ state: 'completed' }),
    warnings: [],
  });
  vi.mocked(bootstrapSharedCart).mockResolvedValue({ ok: true });
  const newId = '33333333-3333-4333-8333-333333333333';
  vi.mocked(createSharedCart).mockResolvedValue({
    ok: true,
    replayed: false,
    snapshot: snapshot({ cartId: newId, version: 0, lines: [] }),
    warnings: [],
  });
  vi.mocked(sendSharedCartCommand).mockResolvedValue({
    ok: true,
    replayed: false,
    snapshot: snapshot({ cartId: newId, version: 1 }),
    warnings: [],
  });
  const { result } = renderHook(() =>
    useSharedCart({
      merchantId: MERCHANT_ID,
      merchantSlug: SLUG,
      sessionGeneration: 1,
    })
  );
  await waitFor(() => expect(result.current.isHydrated).toBe(true));
  await waitFor(() => expect(result.current.cart).toEqual([]));
  await act(async () => result.current.addToCart(product()));
  await waitFor(() => expect(sendSharedCartCommand).toHaveBeenCalledTimes(1));
  expect(bootstrapSharedCart).toHaveBeenCalledTimes(1);
  expect(createSharedCart).toHaveBeenCalledWith(
    { operationId: expect.any(String) },
    SLUG
  );
  expect(result.current.cartId).toBe(newId);
});
it('retries an add on a new cart when checkout completed before the mutation', async () => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  mockAdopted();
  vi.mocked(bootstrapSharedCart).mockResolvedValue({ ok: true });
  const newId = '33333333-3333-4333-8333-333333333333';
  vi.mocked(createSharedCart).mockResolvedValue({
    ok: true,
    replayed: false,
    snapshot: snapshot({ cartId: newId, version: 0, lines: [] }),
    warnings: [],
  });
  vi.mocked(sendSharedCartCommand)
    .mockResolvedValueOnce({
      ok: false,
      code: 'cart_locked',
      retryable: false,
      snapshot: null,
    })
    .mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({ cartId: newId, version: 1 }),
      warnings: [],
    });
  const { result } = renderHook(() =>
    useSharedCart({
      merchantId: MERCHANT_ID,
      merchantSlug: SLUG,
      sessionGeneration: 1,
    })
  );
  await waitFor(() => expect(result.current.cart).toHaveLength(1));
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: true,
    snapshot: snapshot({ state: 'completed', version: 4 }),
    warnings: [],
  });
  await act(async () => result.current.addToCart(product()));
  await waitFor(() => expect(result.current.cartId).toBe(newId));
  expect(sendSharedCartCommand).toHaveBeenCalledTimes(2);
});
