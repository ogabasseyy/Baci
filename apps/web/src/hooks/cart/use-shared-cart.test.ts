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

  it('exposes a manual refresh that refetches a stale snapshot', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchSharedCartSnapshot)
        .mockResolvedValueOnce({
          ok: true,
          snapshot: snapshot({ version: 3 }),
          warnings: [],
        })
        .mockResolvedValueOnce({
          ok: true,
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
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1);
      expect(result.current.version).toBe(3);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });
      await act(async () => {
        await result.current.refreshSharedCart();
      });

      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(2);
      expect(result.current.version).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refetches immediately even inside the coalescing window', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchSharedCartSnapshot)
        .mockResolvedValueOnce({
          ok: true,
          snapshot: snapshot({ version: 3 }),
          warnings: [],
        })
        .mockResolvedValueOnce({
          ok: true,
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
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1);

      // No clock advance: an explicit stale-review refresh bypasses the
      // 5s fetch coalescing so the next submit sees the live version.
      await act(async () => {
        await result.current.refreshSharedCart();
      });

      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(2);
      expect(result.current.version).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refetches while the document is hidden', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchSharedCartSnapshot)
        .mockResolvedValueOnce({
          ok: true,
          snapshot: snapshot({ version: 3 }),
          warnings: [],
        })
        .mockResolvedValueOnce({
          ok: true,
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
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1);

      const hidden = Object.getOwnPropertyDescriptor(document, 'hidden');
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: true,
      });
      try {
        await act(async () => {
          await result.current.refreshSharedCart();
        });
      } finally {
        if (hidden) Object.defineProperty(document, 'hidden', hidden);
      }

      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(2);
      expect(result.current.version).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves refreshSharedCart without fetching when disabled', async () => {
    const { result } = renderHook(() =>
      useSharedCart({
        enabled: false,
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: 1,
      })
    );

    await act(async () => {
      await result.current.refreshSharedCart();
    });
    expect(fetchSharedCartSnapshot).not.toHaveBeenCalled();
  });
});
