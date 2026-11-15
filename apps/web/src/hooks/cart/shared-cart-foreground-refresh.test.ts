import type { CartLine, CartSnapshot } from '@baci/shared/cart';

import { act, renderHook } from '@testing-library/react';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchSharedCartProducts,
  fetchSharedCartSnapshot,
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

function snapshot(): CartSnapshot {
  const line = {
    id: 'line-1',
    item: { productId: 'prod-1' },
    lineTotalMinor: 10000,
    quantity: 1,
    unitPriceMinor: 10000,
  } as CartLine;
  return {
    cartId: CART_ID,
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    lines: [line],
    merchantId: MERCHANT_ID,
    state: 'active',
    subtotalMinor: 10000,
    totalMinor: 10000,
    version: 3,
  } as CartSnapshot;
}

describe('useSharedCart foreground refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
    vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
      ok: true,
      snapshot: snapshot(),
      warnings: [],
    });
  });

  it('shares one read between visibility and focus firing together', async () => {
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
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000);
      });
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1);

      // Returning to the tab fires both events before the first read
      // settles; a second read would hold the cart request lock and delay
      // the shopper's next edit by a full round trip.
      type FetchResult = Awaited<ReturnType<typeof fetchSharedCartSnapshot>>;
      let settle: (value: FetchResult) => void = () => {};
      vi.mocked(fetchSharedCartSnapshot).mockReturnValueOnce(
        new Promise<FetchResult>((resolve) => {
          settle = resolve;
        })
      );
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(2);

      // A failed read gives the window back so the next focus retries.
      await act(async () => {
        settle({
          code: 'temporarily_unavailable',
          ok: false,
          retryable: true,
          snapshot: null,
        });
        await vi.advanceTimersByTimeAsync(0);
        window.dispatchEvent(new Event('focus'));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
