import type { CartSnapshot } from '@baci/shared/cart';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { linkAccountCart } from './shared-cart-account-link-client';
import { fetchSavedAccountCart } from './shared-cart-saved-cart-client';
import { bumpCartSessionGeneration } from './shared-cart-storage';
import { useCartAccountLink } from './use-cart-account-link';

vi.mock('./shared-cart-account-link-client', () => ({
  linkAccountCart: vi.fn(),
}));
vi.mock('./shared-cart-saved-cart-client', () => ({
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
  vi.mocked(linkAccountCart).mockReset().mockResolvedValue({
    ok: false,
    code: 'temporarily_unavailable',
    retryable: true,
    snapshot: null,
  });
  vi.mocked(fetchSavedAccountCart).mockReset();
  vi.mocked(fetchSavedAccountCart).mockResolvedValue({
    ok: true,
    cart: saved,
  });
});
it('checks the current merchant generation after a merchant switch', async () => {
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
  await act(async () => result.current.loadSavedCart());
  rerender({ shop: 'shop-b', user: 'user-a' });
  await act(async () => result.current.loadSavedCart());
  let pending: Promise<boolean> = Promise.resolve(false);
  act(() => {
    pending = result.current.link('keep_current');
  });
  // Retiring the previous merchant must not fence the new merchant's link.
  act(() => {
    bumpCartSessionGeneration({ merchantSlug: 'shop-a' });
  });
  await act(async () => {
    finish({
      ok: true,
      snapshot: saved,
      replayed: false,
      warnings: [],
    });
    await pending;
  });
  expect(onLinked).toHaveBeenCalledOnce();
  await expect(pending).resolves.toBe(true);
});
