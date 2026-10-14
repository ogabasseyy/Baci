import type { CartSnapshot } from '@baci/shared/cart';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  fetchSavedAccountCart,
  linkAccountCart,
} from './shared-cart-account-client';
import { useCartAccountLink } from './use-cart-account-link';

vi.mock('./shared-cart-account-client', () => ({
  linkAccountCart: vi.fn(),
  fetchSavedAccountCart: vi.fn(),
}));
const saved: CartSnapshot = {
  cartId: 'saved',
  merchantId: 'merchant',
  lines: [],
  version: 1,
  state: 'active',
  currency: 'NGN',
  subtotalMinor: 0,
  totalMinor: 0,
  estimatedTotals: true,
  expiresAt: '2026-10-20T00:00:00Z',
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchSavedAccountCart).mockResolvedValue({
    ok: true,
    cart: saved,
  });
});
it('acknowledges the observed saved cart when keeping the current cart', async () => {
  vi.mocked(linkAccountCart).mockResolvedValue({
    ok: true,
    snapshot: saved,
    replayed: false,
    warnings: [],
  });
  const { result } = renderHook(() =>
    useCartAccountLink({ merchantSlug: 'shop', ownerSubject: 'user-a' })
  );
  await act(async () => {
    await result.current.loadSavedCart();
  });
  await act(async () => {
    await result.current.link('keep_current');
  });
  expect(vi.mocked(linkAccountCart).mock.calls[0][0]).toMatchObject({
    choice: 'keep_current',
    expectedSavedCartId: 'saved',
  });
});
it('retries the complete original body instead of reusing its key with a different choice', async () => {
  vi.mocked(linkAccountCart)
    .mockResolvedValueOnce({
      ok: false,
      code: 'temporarily_unavailable',
      retryable: true,
      snapshot: null,
    })
    .mockResolvedValue({
      ok: false,
      code: 'temporarily_unavailable',
      retryable: true,
      snapshot: null,
    });
  const { result } = renderHook(() =>
    useCartAccountLink({ merchantSlug: 'shop', ownerSubject: 'user-a' })
  );
  await act(async () => {
    await result.current.link('keep_current');
  });
  await act(async () => {
    await result.current.link('use_saved');
  });
  expect(vi.mocked(linkAccountCart).mock.calls[1][0]).toEqual(
    vi.mocked(linkAccountCart).mock.calls[0][0]
  );
});
it('does not publish a completed link into a new merchant or shopper scope', async () => {
  let finish: (value: Awaited<ReturnType<typeof linkAccountCart>>) => void =
    () => {};
  vi.mocked(linkAccountCart).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const onLinked = vi.fn();
  const { result, rerender } = renderHook(
    ({ shop, user }) =>
      useCartAccountLink({ merchantSlug: shop, ownerSubject: user, onLinked }),
    { initialProps: { shop: 'shop-a', user: 'user-a' } }
  );
  let pending: Promise<boolean>;
  act(() => {
    pending = result.current.link('keep_current');
  });
  rerender({ shop: 'shop-b', user: 'user-b' });
  await act(async () => {
    finish({
      ok: true,
      snapshot: { ...saved, cartId: 'old' },
      replayed: false,
      warnings: [],
    });
    await pending;
  });
  expect(onLinked).not.toHaveBeenCalled();
  expect(result.current.status).toBe('idle');
});
