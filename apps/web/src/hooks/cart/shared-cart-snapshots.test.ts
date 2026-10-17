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
