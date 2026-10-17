import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fetchSharedCartSnapshot } from './shared-cart-client';
import { useCartSubscription } from './use-cart-subscription';
import { useSharedCart } from './use-shared-cart';

vi.mock('./use-cart-subscription', () => ({
  useCartSubscription: vi.fn(() => false),
}));
vi.mock('./shared-cart-client', () => ({
  fetchSharedCartSnapshot: vi.fn(),
  fetchSharedCartProducts: vi.fn(),
  bootstrapSharedCart: vi.fn(),
  createSharedCart: vi.fn(),
  sendSharedCartCommand: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: true,
    warnings: [],
    snapshot: {
      cartId: 'c',
      merchantId: 'm',
      currency: 'NGN',
      version: 2,
      state: 'active',
      expiresAt: '2099-01-01',
      lines: [],
      subtotalMinor: 0,
      totalMinor: 0,
      estimatedTotals: false,
    },
  });
});
it('subscribes to the adopted cart only with explicit realtime enrollment', async () => {
  renderHook(() =>
    useSharedCart({
      merchantId: 'm',
      merchantSlug: 'shop',
      sessionGeneration: 1,
      realtimeEnabled: true,
    })
  );
  await waitFor(() =>
    expect(useCartSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        merchantId: 'm',
        cartId: 'c',
        version: 2,
        generation: 1,
      })
    )
  );
});
it('keeps un-enrolled and absent carts socket-free', () => {
  renderHook(() =>
    useSharedCart({
      merchantId: 'm',
      merchantSlug: 'shop',
      sessionGeneration: 1,
      enabled: false,
    })
  );
  expect(useCartSubscription).toHaveBeenCalledWith(
    expect.objectContaining({ enabled: false, cartId: null })
  );
});
