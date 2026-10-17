import type { CartLine, CartSnapshot } from '@baci/shared/cart';

import { act, renderHook, waitFor } from '@testing-library/react';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Product } from '@/lib/products';

import {
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

  it('does not let a capped ordinary line block a voucher add', async () => {
    // The server keeps attachment-distinct lines separate with their
    // own per-line caps, so an ordinary line at the cap of 10 must not
    // clamp a one-unit voucher add for the same product to zero.
    mockAdopted(3, [cartLine({ quantity: 10 })]);
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({
        lines: [
          cartLine({ quantity: 10 }),
          cartLine({
            id: 'line-voucher',
            lineTotalMinor: 0,
            quantity: 1,
            unitPriceMinor: 0,
            voucherToken: 'tok-1',
          }),
        ],
        version: 4,
      }),
      warnings: [],
    });
    const { result } = await linkedHook();

    await act(async () => {
      result.current.addToCart(product(), 1, { quizVoucherToken: 'tok-1' });
    });

    await waitFor(() =>
      expect(vi.mocked(sendSharedCartCommand)).toHaveBeenCalledTimes(1)
    );
    expect(vi.mocked(sendSharedCartCommand).mock.calls[0]?.[0]).toMatchObject({
      command: { quantity: 1, type: 'add' },
    });
  });

  it('does not let a capped negotiated line block an ordinary add', async () => {
    // A negotiated line is a separate server lane from an ordinary
    // line for the same product, so its quantity must not consume the
    // ordinary add's per-line cap.
    mockAdopted(3, [
      cartLine({
        negotiatedUnitPriceMinor: 9000,
        negotiationStatus: 'accepted',
        quantity: 10,
      }),
    ]);
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({
        lines: [
          cartLine({
            negotiatedUnitPriceMinor: 9000,
            negotiationStatus: 'accepted',
            quantity: 10,
          }),
          cartLine({ id: 'line-2', quantity: 5 }),
        ],
        version: 4,
      }),
      warnings: [],
    });
    const { result } = await linkedHook();

    await act(async () => {
      result.current.addToCart(product(), 5);
    });

    await waitFor(() =>
      expect(vi.mocked(sendSharedCartCommand)).toHaveBeenCalledTimes(1)
    );
    expect(vi.mocked(sendSharedCartCommand).mock.calls[0]?.[0]).toMatchObject({
      command: { quantity: 5, type: 'add' },
    });
  });

  it('does not let a voucher line eat into an ordinary add headroom', async () => {
    mockAdopted(3, [
      cartLine({
        id: 'line-voucher',
        lineTotalMinor: 0,
        quantity: 1,
        unitPriceMinor: 0,
        voucherToken: 'tok-1',
      }),
    ]);
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({
        lines: [
          cartLine({
            id: 'line-voucher',
            lineTotalMinor: 0,
            quantity: 1,
            unitPriceMinor: 0,
            voucherToken: 'tok-1',
          }),
          cartLine({ id: 'line-2', quantity: 10 }),
        ],
        version: 4,
      }),
      warnings: [],
    });
    const { result } = await linkedHook();

    await act(async () => {
      result.current.addToCart(product(), 10);
    });

    await waitFor(() =>
      expect(vi.mocked(sendSharedCartCommand)).toHaveBeenCalledTimes(1)
    );
    // The full cap of 10 is available to the ordinary line; the
    // voucher line's reserved unit belongs to a different server line.
    expect(vi.mocked(sendSharedCartCommand).mock.calls[0]?.[0]).toMatchObject({
      command: { quantity: 10, type: 'add' },
    });
  });
});
it('does not create an assurance overlay when repricing a line', async () => {
  const { createCartActions } = await import('./shared-cart-actions');
  const dispatch = vi.fn();
  const actions = createCartActions({
    enabled: true,
    dispatch,
    stateRef: { current: {} },
    generationRef: { current: 1 },
    tempCounterRef: { current: 0 },
  } as never);
  actions.repriceLine(
    {
      ...product(),
      cartItemId: 'line-1',
      serverLineId: 'line-1',
      quantity: 1,
      hasAssurance: true,
    } as never,
    50
  );
  expect(
    dispatch.mock.calls.some(([action]) => action.type === 'assurance/overlay')
  ).toBe(false);
});
it('checks for completion before clearing a bound cart after checkout', async () => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  mockAdopted();
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
  await act(async () => result.current.clearCart());
  await waitFor(() => expect(result.current.cart).toEqual([]));
  expect(sendSharedCartCommand).not.toHaveBeenCalled();
});
