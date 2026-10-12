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

describe('useSharedCart link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  });

  it('shows the cached cart instantly, then adopts the server snapshot', async () => {
    saveCartToStorage(
      [cartItem({ id: 'cached-1', name: 'Cached', price: 50, quantity: 2 })],
      SLUG
    );
    mockAdopted();
    // The cached line imports, then the receipt pins the adopted cart.
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({
        lines: [
          cartLine(),
          cartLine({
            id: 'line-cached',
            item: { productId: 'cached-1' },
            lineTotalMinor: 10000,
            quantity: 2,
            unitPriceMinor: 5000,
          }),
        ],
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

    // Instant: the cache is the display before any network resolves.
    expect(result.current.isHydrated).toBe(true);
    expect(result.current.cart.map((line) => line.id)).toEqual(['cached-1']);

    await waitFor(() => expect(result.current.cartId).toBe(CART_ID));
    // The cached line stays visible through the import, then the
    // confirmed snapshot (import included) takes over exactly once.
    await waitFor(() =>
      expect(result.current.cart.map((line) => line.id)).toEqual([
        'prod-1',
        'cached-1',
      ])
    );
    expect(result.current.version).toBe(4);
    expect(result.current.syncStatus).toBe('synced');
    expect(result.current.importStatus).toBe('done');
  });

  it('hydrates foreign lines the cache has never seen', async () => {
    mockAdopted(3, [
      cartLine({
        id: 'line-foreign',
        item: { productId: 'prod-foreign' },
      }),
    ]);
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(
      new Map([
        ['prod-foreign', product({ id: 'prod-foreign', name: 'Charger' })],
      ])
    );

    const { result } = renderHook(() =>
      useSharedCart({
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );

    await waitFor(() => expect(result.current.cart[0]?.name).toBe('Charger'));
    expect(fetchSharedCartProducts).toHaveBeenCalledWith(
      ['prod-foreign'],
      MERCHANT_ID
    );
  });

  it('stays idle without a session until the first action bootstraps', async () => {
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
      snapshot: snapshot({ lines: [], version: 1 }),
      warnings: [],
    });
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({
        lines: [
          cartLine({
            id: 'line-new',
            item: { productId: 'prod-9' },
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
    expect(bootstrapSharedCart).not.toHaveBeenCalled();
    expect(result.current.cart).toHaveLength(0);

    await act(async () => {
      result.current.addToCart(product({ id: 'prod-9' }), 1);
    });
    // Optimistic feedback lands before the bootstrap round trips.
    expect(result.current.cart.map((line) => line.id)).toEqual(['prod-9']);

    await waitFor(() => expect(result.current.cartId).toBe(CART_ID));
    expect(bootstrapSharedCart).toHaveBeenCalledWith(SLUG);
    expect(createSharedCart).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendSharedCartCommand).mock.calls[0]?.[0]).toMatchObject({
      expectedVersion: 1,
      operationId: expect.any(String),
    });
    await waitFor(() =>
      expect(result.current.cart[0]?.serverLineId).toBe('line-new')
    );
  });

  it('re-bootstraps on first action when the proof expired', async () => {
    vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
      code: 'expired',
      ok: false,
      retryable: false,
      snapshot: null,
    });
    vi.mocked(bootstrapSharedCart).mockResolvedValue({ ok: true });
    vi.mocked(createSharedCart).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({ lines: [], version: 1 }),
      warnings: [],
    });
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({ lines: [], version: 2 }),
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

    await waitFor(() => expect(bootstrapSharedCart).toHaveBeenCalledTimes(1));
  });

  it('retries a failed adopt instead of orphaning the session with a blind bootstrap', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchSharedCartSnapshot)
        .mockResolvedValueOnce({
          code: 'temporarily_unavailable',
          ok: false,
          retryable: true,
          snapshot: null,
        })
        .mockResolvedValueOnce({
          ok: true,
          snapshot: snapshot({ version: 3 }),
          warnings: [],
        });

      const { result } = renderHook(() =>
        useSharedCart({
          merchantId: MERCHANT_ID,
          merchantSlug: SLUG,
          sessionGeneration: 1,
        })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1);
      expect(result.current.cartId).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      // The advance flushes the retry timer and the adopt chain, so the
      // adoption is assertable synchronously (no waitFor under fake timers).
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(2);
      expect(result.current.cartId).toBe(CART_ID);
      expect(bootstrapSharedCart).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays inert when disabled', async () => {
    const { result } = renderHook(() =>
      useSharedCart({
        enabled: false,
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );

    expect(result.current.cart).toEqual([]);
    expect(result.current.isHydrated).toBe(true);
    await act(async () => {
      result.current.addToCart(product(), 1);
    });
    expect(fetchSharedCartSnapshot).not.toHaveBeenCalled();
    expect(result.current.cart).toEqual([]);
  });

  it("never persists one merchant's lines under another merchant's key", async () => {
    vi.mocked(fetchSharedCartSnapshot)
      .mockResolvedValueOnce({
        ok: true,
        snapshot: snapshot({
          lines: [cartLine({ id: 'line-a', item: { productId: 'prod-a' } })],
          version: 3,
        }),
        warnings: [],
      })
      .mockResolvedValue({
        ok: true,
        snapshot: snapshot({
          lines: [cartLine({ id: 'line-b', item: { productId: 'prod-b' } })],
          version: 7,
        }),
        warnings: [],
      });
    const { rerender } = renderHook(
      ({ generation, slug }) =>
        useSharedCart({
          merchantId: MERCHANT_ID,
          merchantSlug: slug,
          sessionGeneration: generation,
        }),
      { initialProps: { generation: 1, slug: 'first' } }
    );
    await waitFor(() =>
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1)
    );
    await waitFor(() =>
      expect(
        window.localStorage.getItem('baci-cart-first-guest')
      ).not.toBeNull()
    );

    // The provider switches slug and generation in one commit. The
    // transition commit still holds merchant A's reducer state while
    // carrying merchant B's slug; persisting there would file A's lines
    // under B's key, poisoning B's next cache seed and legacy import.
    rerender({ generation: 2, slug: 'second' });
    expect(window.localStorage.getItem('baci-cart-second-guest')).toBeNull();

    await waitFor(() =>
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(2)
    );
  });
});

describe('useSharedCart actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
    mockAdopted();
  });

  async function linkedHook() {
    const hook = renderHook(() =>
      useSharedCart({
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );
    await waitFor(() => expect(hook.result.current.cartId).toBe(CART_ID));
    vi.clearAllMocks();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
    return hook;
  }

  it('sends one versioned command per action and reconciles the response', async () => {
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({
        lines: [
          cartLine(),
          cartLine({
            id: 'line-9',
            item: { productId: 'prod-9' },
            lineTotalMinor: 20000,
            quantity: 2,
            unitPriceMinor: 10000,
          }),
        ],
        version: 4,
      }),
      warnings: [],
    });
    const { result } = await linkedHook();

    await act(async () => {
      result.current.addToCart(product({ id: 'prod-9', price: 100 }), 2);
    });

    expect(vi.mocked(sendSharedCartCommand).mock.calls[0]?.[0]).toMatchObject({
      command: {
        item: { productId: 'prod-9' },
        quantity: 2,
        type: 'add',
      },
      expectedVersion: 3,
      operationId: expect.any(String),
    });
    await waitFor(() => expect(result.current.version).toBe(4));
    expect(result.current.cart).toHaveLength(2);
    expect(result.current.syncStatus).toBe('synced');
  });

  it('serializes rapid actions with fresh versions and preserved keys', async () => {
    const firstResponse = {
      ok: true as const,
      replayed: false,
      snapshot: snapshot({
        lines: [
          cartLine({
            id: 'line-9',
            item: { productId: 'prod-9' },
            quantity: 1,
          }),
        ],
        version: 4,
      }),
      warnings: [],
    };
    const secondResponse = {
      ok: true as const,
      replayed: false,
      snapshot: snapshot({
        lines: [
          cartLine({
            id: 'line-9',
            item: { productId: 'prod-9' },
            lineTotalMinor: 30000,
            quantity: 3,
            unitPriceMinor: 10000,
          }),
        ],
        version: 5,
      }),
      warnings: [],
    };
    let releaseFirst!: (value: typeof firstResponse) => void;
    const firstGate = new Promise<typeof firstResponse>((resolve) => {
      releaseFirst = resolve;
    });
    vi.mocked(sendSharedCartCommand)
      .mockReturnValueOnce(firstGate)
      .mockResolvedValueOnce(secondResponse);
    const { result } = await linkedHook();

    await act(async () => {
      result.current.addToCart(product({ id: 'prod-9' }), 1);
    });
    const tempId = result.current.cart.find(
      (line) => line.id === 'prod-9'
    )?.pendingTempId;
    expect(tempId).toEqual(expect.any(String));
    await act(async () => {
      result.current.updateQuantity(`temp:${tempId}`, 3);
    });

    expect(vi.mocked(sendSharedCartCommand)).toHaveBeenCalledTimes(1);
    releaseFirst(firstResponse);
    await waitFor(() =>
      expect(vi.mocked(sendSharedCartCommand)).toHaveBeenCalledTimes(2)
    );

    const [first, second] = vi.mocked(sendSharedCartCommand).mock.calls;
    expect(first?.[0]).toMatchObject({ expectedVersion: 3 });
    // The dependent edit waits for the stable line id, then sends with
    // the fresh version — same retry key it was enqueued with.
    expect(second?.[0]).toMatchObject({
      command: { lineId: 'line-9', quantity: 3, type: 'set_quantity' },
      expectedVersion: 4,
    });
    expect(second?.[0]?.operationId).not.toBe(first?.[0]?.operationId);
    await waitFor(() => expect(result.current.version).toBe(5));
  });

  it('sends two rapid edits on the same confirmed line without stalling', async () => {
    const firstResponse = {
      ok: true as const,
      replayed: false,
      snapshot: snapshot({
        lines: [cartLine({ lineTotalMinor: 20000, quantity: 2 })],
        version: 4,
      }),
      warnings: [],
    };
    const secondResponse = {
      ok: true as const,
      replayed: false,
      snapshot: snapshot({
        lines: [cartLine({ lineTotalMinor: 30000, quantity: 3 })],
        version: 5,
      }),
      warnings: [],
    };
    let releaseFirst!: (value: typeof firstResponse) => void;
    const firstGate = new Promise<typeof firstResponse>((resolve) => {
      releaseFirst = resolve;
    });
    vi.mocked(sendSharedCartCommand)
      .mockReturnValueOnce(firstGate)
      .mockResolvedValueOnce(secondResponse);
    const { result } = await linkedHook();

    await act(async () => {
      result.current.updateQuantity('prod-1', 2);
    });
    await waitFor(() =>
      expect(vi.mocked(sendSharedCartCommand)).toHaveBeenCalledTimes(1)
    );
    // The second edit lands while the first is still in flight. If the
    // first edit claimed a temp id on the confirmed line, this edit
    // would block on a temp that no add reconcile ever resolves.
    await act(async () => {
      result.current.updateQuantity('prod-1', 3);
    });

    releaseFirst(firstResponse);
    await waitFor(() =>
      expect(vi.mocked(sendSharedCartCommand)).toHaveBeenCalledTimes(2)
    );
    const [, second] = vi.mocked(sendSharedCartCommand).mock.calls;
    expect(second?.[0]).toMatchObject({
      command: { lineId: 'line-1', quantity: 3, type: 'set_quantity' },
      expectedVersion: 4,
    });
    await waitFor(() => expect(result.current.cart[0]?.quantity).toBe(3));
  });

  it('hydrates products for lines a reconcile introduces', async () => {
    // Another device added prod-remote concurrently: the reconciled
    // snapshot carries a line this session has never hydrated.
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({
        lines: [
          cartLine(),
          cartLine({ id: 'line-9', item: { productId: 'prod-9' } }),
          cartLine({ id: 'line-remote', item: { productId: 'prod-remote' } }),
        ],
        version: 4,
      }),
      warnings: [],
    });
    const { result } = await linkedHook();
    // linkedHook resets the products mock after adoption; set the
    // shells the reconcile hydration will fetch.
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(
      new Map([
        ['prod-1', product()],
        ['prod-9', product({ id: 'prod-9', name: 'Camera' })],
        ['prod-remote', product({ id: 'prod-remote', name: 'Charger' })],
      ])
    );

    await act(async () => {
      result.current.addToCart(product({ id: 'prod-9' }), 1);
    });

    await waitFor(() => expect(result.current.cart).toHaveLength(3));
    expect(fetchSharedCartProducts).toHaveBeenCalledWith(
      expect.arrayContaining(['prod-remote']),
      MERCHANT_ID
    );
    await waitFor(() =>
      expect(
        result.current.cart.find((line) => line.id === 'prod-remote')?.name
      ).toBe('Charger')
    );
  });

  it('removes and clears through versioned commands', async () => {
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({ lines: [], version: 4 }),
      warnings: [],
    });
    const { result } = await linkedHook();

    await act(async () => {
      result.current.removeFromCart('line-1');
    });
    expect(vi.mocked(sendSharedCartCommand).mock.calls[0]?.[0]).toMatchObject({
      command: { lineId: 'line-1', type: 'remove' },
    });

    await act(async () => {
      result.current.clearCart();
    });
    await waitFor(() =>
      expect(vi.mocked(sendSharedCartCommand)).toHaveBeenCalledTimes(2)
    );
    expect(vi.mocked(sendSharedCartCommand).mock.calls[1]?.[0]).toMatchObject({
      command: { type: 'clear' },
    });
  });

  it('rebases on version conflicts and retries with the original key', async () => {
    const conflicted = {
      code: 'version_conflict' as const,
      ok: false as const,
      retryable: false,
      snapshot: snapshot({ version: 6 }),
    };
    const recovered = {
      ok: true as const,
      replayed: false,
      snapshot: snapshot({ version: 7 }),
      warnings: [],
    };
    vi.mocked(sendSharedCartCommand)
      .mockResolvedValueOnce(conflicted)
      .mockResolvedValueOnce(recovered);
    const { result } = await linkedHook();

    await act(async () => {
      result.current.addToCart(product({ id: 'prod-9' }), 1);
    });

    await waitFor(() =>
      expect(vi.mocked(sendSharedCartCommand)).toHaveBeenCalledTimes(2)
    );
    const [first, second] = vi.mocked(sendSharedCartCommand).mock.calls;
    expect(first?.[0]).toMatchObject({ expectedVersion: 3 });
    expect(second?.[0]).toMatchObject({
      expectedVersion: 6,
      operationId: first?.[0]?.operationId,
    });
    await waitFor(() => expect(result.current.version).toBe(7));
    expect(result.current.syncError).toBeNull();
  });

  it('refetches before rebasing a conflict that carries no cart', async () => {
    vi.mocked(sendSharedCartCommand)
      .mockResolvedValueOnce({
        code: 'version_conflict',
        ok: false,
        retryable: false,
        snapshot: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        replayed: false,
        snapshot: snapshot({ version: 7 }),
        warnings: [],
      });
    vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
      ok: true,
      snapshot: snapshot({ version: 6 }),
      warnings: [],
    });
    const { result } = await linkedHook();

    await act(async () => {
      result.current.addToCart(product({ id: 'prod-9' }), 1);
    });

    await waitFor(() =>
      expect(vi.mocked(sendSharedCartCommand)).toHaveBeenCalledTimes(2)
    );
    expect(fetchSharedCartSnapshot).toHaveBeenCalled();
    expect(vi.mocked(sendSharedCartCommand).mock.calls[1]?.[0]).toMatchObject({
      expectedVersion: 6,
    });
  });

  it('retries retryable failures with the original key and visible state', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(sendSharedCartCommand)
        .mockResolvedValueOnce({
          code: 'temporarily_unavailable',
          ok: false,
          retryable: true,
          snapshot: null,
        })
        .mockResolvedValueOnce({
          ok: true,
          replayed: false,
          snapshot: snapshot({ version: 4 }),
          warnings: [],
        });
      const { result } = renderHook(() =>
        useSharedCart({
          merchantId: MERCHANT_ID,
          merchantSlug: SLUG,
          sessionGeneration: 1,
        })
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.cartId).toBe(CART_ID);

      await act(async () => {
        result.current.addToCart(product({ id: 'prod-9' }), 1);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.syncStatus).toBe('retrying');

      const firstKey = vi.mocked(sendSharedCartCommand).mock.calls[0]?.[0]
        ?.operationId;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(vi.mocked(sendSharedCartCommand)).toHaveBeenCalledTimes(2);
      expect(
        vi.mocked(sendSharedCartCommand).mock.calls[1]?.[0]?.operationId
      ).toBe(firstKey);
      expect(result.current.version).toBe(4);
      expect(result.current.syncError).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rolls fatal failures back to the last confirmed cart', async () => {
    let release!: (value: {
      code: 'invalid_item';
      ok: false;
      retryable: false;
      snapshot: null;
    }) => void;
    const gate = new Promise<{
      code: 'invalid_item';
      ok: false;
      retryable: false;
      snapshot: null;
    }>((resolve) => {
      release = resolve;
    });
    vi.mocked(sendSharedCartCommand).mockReturnValueOnce(gate);
    const { result } = await linkedHook();

    await act(async () => {
      result.current.addToCart(product({ id: 'prod-9' }), 1);
    });
    expect(result.current.cart.map((line) => line.id)).toEqual([
      'prod-1',
      'prod-9',
    ]);

    await act(async () => {
      release({
        code: 'invalid_item',
        ok: false,
        retryable: false,
        snapshot: null,
      });
    });
    await waitFor(() => expect(result.current.syncError).toBe('invalid_item'));
    expect(result.current.cart.map((line) => line.id)).toEqual(['prod-1']);
    expect(result.current.syncStatus).toBe('error');
  });

  it('retries the failed head on demand', async () => {
    vi.mocked(sendSharedCartCommand)
      .mockResolvedValueOnce({
        code: 'temporarily_unavailable',
        ok: false,
        retryable: true,
        snapshot: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        replayed: false,
        snapshot: snapshot({ version: 4 }),
        warnings: [],
      });
    const { result } = await linkedHook();

    await act(async () => {
      result.current.addToCart(product({ id: 'prod-9' }), 1);
    });
    await waitFor(() => expect(result.current.syncStatus).toBe('retrying'));

    await act(async () => {
      result.current.retryPendingSync();
    });
    await waitFor(() =>
      expect(vi.mocked(sendSharedCartCommand)).toHaveBeenCalledTimes(2)
    );
    await waitFor(() => expect(result.current.version).toBe(4));
  });

  it('ignores late responses after the session generation moves on', async () => {
    let release!: (value: {
      ok: true;
      replayed: boolean;
      snapshot: CartSnapshot;
      warnings: [];
    }) => void;
    const gate = new Promise<{
      ok: true;
      replayed: boolean;
      snapshot: CartSnapshot;
      warnings: [];
    }>((resolve) => {
      release = resolve;
    });
    vi.mocked(sendSharedCartCommand).mockReturnValueOnce(gate);
    const { result, rerender } = renderHook(
      ({ generation }: { generation: number }) =>
        useSharedCart({
          merchantId: MERCHANT_ID,
          merchantSlug: SLUG,
          sessionGeneration: generation,
        }),
      { initialProps: { generation: 1 } }
    );
    await waitFor(() => expect(result.current.cartId).toBe(CART_ID));

    await act(async () => {
      result.current.addToCart(product({ id: 'prod-9' }), 1);
    });
    expect(vi.mocked(sendSharedCartCommand)).toHaveBeenCalledTimes(1);

    rerender({ generation: 2 });
    release({
      ok: true,
      replayed: false,
      snapshot: snapshot({ version: 9 }),
      warnings: [],
    });

    // The stale completion lands after the reset: the new generation
    // re-adopts fresh and never sees the foreign version.
    await waitFor(() => expect(result.current.cartId).toBe(CART_ID));
    expect(result.current.version).toBe(3);
    expect(result.current.cart.map((line) => line.id)).toEqual(['prod-1']);
  });

  it('clamps lines to the canonical per-line bound instead of failing', async () => {
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({
        lines: [
          cartLine({
            lineTotalMinor: 100000,
            quantity: 10,
            unitPriceMinor: 10000,
          }),
        ],
        version: 4,
      }),
      warnings: [],
    });
    const { result } = await linkedHook();

    await act(async () => {
      result.current.updateQuantity('line-1', 99);
    });

    expect(vi.mocked(sendSharedCartCommand).mock.calls[0]?.[0]).toMatchObject({
      command: { lineId: 'line-1', quantity: 10, type: 'set_quantity' },
    });
  });

  it('mirrors the legacy stock and variant guards before queueing', async () => {
    const { result } = await linkedHook();

    await act(async () => {
      result.current.addToCart(product({ manage_stock: true, stock: 0 }), 1);
      result.current.addToCart(product({ id: 'prod-var' }), 1, {
        variantRequired: true,
      } as never);
    });

    expect(vi.mocked(sendSharedCartCommand)).not.toHaveBeenCalled();
    expect(result.current.cart.map((line) => line.id)).toEqual(['prod-1']);
  });

  it('exempts quiz-award lines from the stock guard like the provider gate', async () => {
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({
        lines: [
          cartLine(),
          cartLine({
            id: 'line-prize',
            item: { productId: 'prod-prize' },
            lineTotalMinor: 0,
            quantity: 1,
            unitPriceMinor: 0,
          }),
        ],
        version: 4,
      }),
      warnings: [],
    });
    const { result } = await linkedHook();

    // Award id only, no voucher token, zero public stock: the provider
    // gate lets this through, so the hook must not drop it silently.
    await act(async () => {
      result.current.addToCart(
        product({ id: 'prod-prize', manage_stock: true, stock: 0 }),
        3,
        { quizAwardId: 'award-1' }
      );
    });

    await waitFor(() =>
      expect(vi.mocked(sendSharedCartCommand)).toHaveBeenCalledTimes(1)
    );
    // The reserved unit pins to quantity 1 regardless of the request.
    expect(vi.mocked(sendSharedCartCommand).mock.calls[0]?.[0]).toMatchObject({
      command: { quantity: 1, type: 'add' },
    });
  });
});

describe('useSharedCart legacy import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
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

describe('useSharedCart polling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
    mockAdopted();
  });

  it('polls on the fallback cadence while realtime is unavailable', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useSharedCart({
          merchantId: MERCHANT_ID,
          merchantSlug: SLUG,
          sessionGeneration: 1,
        })
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.cartId).toBe(CART_ID);
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(12_000);
      });
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(7_000);
      });
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('slows to the reconciliation cadence once realtime connects', async () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(
        ({ realtime }: { realtime: boolean }) =>
          useSharedCart({
            merchantId: MERCHANT_ID,
            merchantSlug: SLUG,
            realtimeConnected: realtime,
            sessionGeneration: 1,
          }),
        { initialProps: { realtime: false } }
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.cartId).toBe(CART_ID);
      rerender({ realtime: true });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(48_000);
      });
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('defers adoption while hidden and links fully on return', async () => {
    mockAdopted();
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({
        lines: [
          cartLine(),
          cartLine({ id: 'line-9', item: { productId: 'prod-9' } }),
        ],
        version: 4,
      }),
      warnings: [],
    });
    const hidden = { value: true };
    const descriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden.value,
    });
    try {
      const { result } = renderHook(() =>
        useSharedCart({
          merchantId: MERCHANT_ID,
          merchantSlug: SLUG,
          sessionGeneration: 1,
        })
      );
      await act(async () => {
        await Promise.resolve();
      });
      // A background tab or prerender must not fetch or link yet.
      expect(fetchSharedCartSnapshot).not.toHaveBeenCalled();
      expect(result.current.cartId).toBeNull();

      hidden.value = false;
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      // The deferred adoption runs the full link — not just a bare poll
      // fetch that sets the cart id while leaving the queue unready and
      // the import unrun.
      await waitFor(() => expect(result.current.cartId).toBe(CART_ID));
      await waitFor(() => expect(result.current.cart).toHaveLength(1));
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(result.current.importStatus).toBe('skipped'));

      await act(async () => {
        result.current.addToCart(product({ id: 'prod-9' }), 1);
      });
      await waitFor(() =>
        expect(vi.mocked(sendSharedCartCommand)).toHaveBeenCalledTimes(1)
      );
      await waitFor(() => expect(result.current.syncStatus).toBe('synced'));
    } finally {
      if (descriptor) Object.defineProperty(document, 'hidden', descriptor);
    }
  });

  it('stops polling while hidden and refetches on return and focus', async () => {
    vi.useFakeTimers();
    const hidden = { value: false };
    const descriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden.value,
    });
    try {
      const { result } = renderHook(() =>
        useSharedCart({
          merchantId: MERCHANT_ID,
          merchantSlug: SLUG,
          sessionGeneration: 1,
        })
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.cartId).toBe(CART_ID);

      await act(async () => {
        hidden.value = true;
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1);

      await act(async () => {
        hidden.value = false;
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(2);

      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        await vi.advanceTimersByTimeAsync(0);
      });
      // Coalesced: the visibility fetch just landed.
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(2);
    } finally {
      if (descriptor) Object.defineProperty(document, 'hidden', descriptor);
      vi.useRealTimers();
    }
  });

  it('converges a dropped realtime update within one poll window', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchSharedCartSnapshot)
        .mockResolvedValueOnce({
          ok: true,
          snapshot: snapshot({ version: 3 }),
          warnings: [],
        })
        .mockResolvedValue({
          ok: true,
          snapshot: snapshot({
            lines: [
              cartLine(),
              cartLine({
                id: 'line-remote',
                item: { productId: 'prod-remote' },
              }),
            ],
            version: 5,
          }),
          warnings: [],
        });
      const { result } = renderHook(() =>
        useSharedCart({
          merchantId: MERCHANT_ID,
          merchantSlug: SLUG,
          realtimeConnected: true,
          sessionGeneration: 1,
        })
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.cartId).toBe(CART_ID);
      expect(result.current.version).toBe(3);

      // No realtime event arrives; the reconciliation poll still lands
      // the remote change within its window.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(75_000);
      });
      expect(result.current.version).toBe(5);
      expect(result.current.cart.map((line) => line.id)).toEqual([
        'prod-1',
        'prod-remote',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hydrates products for lines a poll introduces', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchSharedCartSnapshot)
        .mockResolvedValueOnce({
          ok: true,
          snapshot: snapshot({ version: 3 }),
          warnings: [],
        })
        .mockResolvedValue({
          ok: true,
          snapshot: snapshot({
            lines: [
              cartLine(),
              cartLine({
                id: 'line-remote',
                item: { productId: 'prod-remote' },
              }),
            ],
            version: 5,
          }),
          warnings: [],
        });
      vi.mocked(fetchSharedCartProducts).mockResolvedValue(
        new Map([
          ['prod-1', product()],
          ['prod-remote', product({ id: 'prod-remote', name: 'Charger' })],
        ])
      );
      const { result } = renderHook(() =>
        useSharedCart({
          merchantId: MERCHANT_ID,
          merchantSlug: SLUG,
          sessionGeneration: 1,
        })
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.version).toBe(3);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(result.current.version).toBe(5);
      expect(fetchSharedCartProducts).toHaveBeenCalledWith(
        expect.arrayContaining(['prod-remote']),
        MERCHANT_ID
      );
      expect(
        result.current.cart.find((line) => line.id === 'prod-remote')?.name
      ).toBe('Charger');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps hydrating ids a newer snapshot queued mid-flight', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchSharedCartSnapshot)
        .mockResolvedValueOnce({
          ok: true,
          snapshot: snapshot({ version: 3 }),
          warnings: [],
        })
        .mockResolvedValue({
          ok: true,
          snapshot: snapshot({
            lines: [
              cartLine(),
              cartLine({
                id: 'line-remote',
                item: { productId: 'prod-remote' },
              }),
            ],
            version: 5,
          }),
          warnings: [],
        });
      // The adoption hydration fetch hangs while the poll lands a newer
      // snapshot: its ids must survive against the live cart, not the
      // stale snapshot that started the hydration loop.
      let resolveFirst!: (value: Map<string, Product>) => void;
      const firstGate = new Promise<Map<string, Product>>((resolve) => {
        resolveFirst = resolve;
      });
      vi.mocked(fetchSharedCartProducts)
        .mockReturnValueOnce(firstGate)
        .mockResolvedValue(
          new Map([
            ['prod-remote', product({ id: 'prod-remote', name: 'Charger' })],
          ])
        );
      const { result } = renderHook(() =>
        useSharedCart({
          merchantId: MERCHANT_ID,
          merchantSlug: SLUG,
          sessionGeneration: 1,
        })
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchSharedCartProducts).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(result.current.version).toBe(5);

      await act(async () => {
        resolveFirst(new Map([['prod-1', product()]]));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchSharedCartProducts).toHaveBeenCalledTimes(2);
      expect(
        result.current.cart.find((line) => line.id === 'prod-remote')?.name
      ).toBe('Charger');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useSharedCart negotiation and totals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
    mockAdopted();
  });

  async function linkedHook() {
    const hook = renderHook(() =>
      useSharedCart({
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );
    await waitFor(() => expect(hook.result.current.cartId).toBe(CART_ID));
    vi.clearAllMocks();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
    return hook;
  }

  it('reprices a line as a remove-plus-add pair with attachments', async () => {
    vi.mocked(sendSharedCartCommand)
      .mockResolvedValueOnce({
        ok: true,
        replayed: false,
        snapshot: snapshot({ lines: [], version: 4 }),
        warnings: [],
      })
      .mockResolvedValueOnce({
        ok: true,
        replayed: false,
        snapshot: snapshot({
          lines: [
            cartLine({
              id: 'line-2',
              lineTotalMinor: 7500,
              negotiatedUnitPriceMinor: 7500,
              negotiationStatus: 'accepted',
              quantity: 1,
              unitPriceMinor: 10000,
            }),
          ],
          version: 5,
        }),
        warnings: [],
      });
    const { result } = await linkedHook();
    const line = result.current.cart[0];
    if (!line) throw new Error('expected a line');

    await act(async () => {
      result.current.repriceLine(line, 75);
    });

    // Optimistic: the old line drops, the repriced temp takes its place.
    expect(result.current.cart[0]).toMatchObject({
      negotiatedPrice: 75,
      negotiationStatus: 'accepted',
    });
    await waitFor(() =>
      expect(vi.mocked(sendSharedCartCommand)).toHaveBeenCalledTimes(2)
    );
    const calls = vi.mocked(sendSharedCartCommand).mock.calls;
    expect(calls[0]?.[0]).toMatchObject({
      command: { lineId: 'line-1', type: 'remove' },
    });
    expect(calls[1]?.[0]).toMatchObject({
      command: {
        item: { productId: 'prod-1' },
        negotiatedUnitPriceMinor: 7500,
        negotiationStatus: 'accepted',
        quantity: 1,
        type: 'add',
      },
    });
    await waitFor(() => expect(result.current.version).toBe(5));
  });

  it('toggles assurance display-locally without queueing a command', async () => {
    const { result } = await linkedHook();
    const line = result.current.cart[0];
    if (!line) throw new Error('expected a line');
    expect(line.hasAssurance).toBe(false);

    await act(async () => {
      result.current.toggleAssurance(line.cartItemId);
    });

    expect(result.current.cart[0]?.hasAssurance).toBe(true);
    expect(vi.mocked(sendSharedCartCommand)).not.toHaveBeenCalled();
  });

  it('derives counts and totals from the display like the legacy cart', async () => {
    mockAdopted(3, [
      cartLine({
        lineTotalMinor: 20000,
        quantity: 2,
        unitPriceMinor: 10000,
      }),
      cartLine({
        hasAssurance: true,
        id: 'line-2',
        item: { productId: 'prod-2' },
        lineTotalMinor: 5000,
        quantity: 1,
        unitPriceMinor: 5000,
      }),
    ]);
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(
      new Map([
        ['prod-1', product({ id: 'prod-1', price: 100 })],
        ['prod-2', product({ id: 'prod-2', name: 'Case', price: 50 })],
      ])
    );
    // NOTE: products keyed by product id here only to keep the fixture
    // small; the hook re-keys them by line identity before storing.
    const { result } = renderHook(() =>
      useSharedCart({
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );

    await waitFor(() => expect(result.current.cartId).toBe(CART_ID));
    expect(result.current.cartCount).toBe(3);
    // 2×100 + 1×50, plus 5% assurance on the covered line.
    expect(result.current.cartTotal).toBeCloseTo(252.5, 2);
  });
});
