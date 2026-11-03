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
it('retains the exact account selection replay after its own failed-transition relink', async () => {
  vi.mocked(linkAccountCart).mockImplementation(async (input, merchantSlug) => {
    bumpCartSessionGeneration({ merchantSlug, operationId: input.operationId });
    return {
      ok: false,
      code: 'temporarily_unavailable',
      retryable: true,
      snapshot: null,
    };
  });
  const { result } = renderHook(() =>
    useCartAccountLink({ merchantSlug: 'shop', ownerSubject: 'user-a' })
  );
  await act(async () => result.current.loadSavedCart());
  await act(async () => {
    await result.current.link('use_saved');
  });
  expect(result.current.status).toBe('error');
  expect(result.current.pending).toBe(true);
  await act(async () => {
    await result.current.loadSavedCart();
  });
  expect(result.current.status).toBe('error');
  const original = vi.mocked(linkAccountCart).mock.calls[0][0];
  await act(async () => {
    await result.current.retry();
  });
  expect(vi.mocked(linkAccountCart).mock.calls[1][0]).toEqual(original);
});

it('releases a definitive failed selection after its transition relink', async () => {
  vi.mocked(linkAccountCart).mockImplementation(
    async (_input, merchantSlug) => {
      bumpCartSessionGeneration({ merchantSlug });
      return {
        ok: false,
        code: 'version_conflict',
        retryable: false,
        snapshot: null,
      };
    }
  );
  const { result } = renderHook(() =>
    useCartAccountLink({ merchantSlug: 'shop', ownerSubject: 'user-a' })
  );
  await act(async () => result.current.loadSavedCart());
  await act(async () => {
    await result.current.link('use_saved');
  });
  expect(result.current.pending).toBe(false);
  await act(async () => {
    await result.current.loadSavedCart();
    await result.current.link('keep_current');
  });
  expect(vi.mocked(linkAccountCart).mock.calls[1][0].operationId).not.toBe(
    vi.mocked(linkAccountCart).mock.calls[0][0].operationId
  );
});
