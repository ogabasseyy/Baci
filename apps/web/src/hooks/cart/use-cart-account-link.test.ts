import type { CartSnapshot } from '@baci/shared/cart';
import { act, renderHook } from '@testing-library/react';
import { createElement, StrictMode, useEffect } from 'react';
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
  await act(async () => result.current.loadSavedCart());
  await act(async () => {
    await result.current.link('keep_current');
  });
  await act(async () => {
    expect(await result.current.link('use_saved')).toBe(false);
  });
  await act(async () => {
    await result.current.retry();
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
  await act(async () => result.current.loadSavedCart());
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

it('rejects choices before or during a delayed saved-cart read', async () => {
  let finish: (
    value: Awaited<ReturnType<typeof fetchSavedAccountCart>>
  ) => void = () => {};
  vi.mocked(fetchSavedAccountCart).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { result } = renderHook(() =>
    useCartAccountLink({ merchantSlug: 'shop', ownerSubject: 'user-a' })
  );
  await act(async () => {
    expect(await result.current.link('keep_current')).toBe(false);
  });
  let loading: Promise<void>;
  act(() => {
    loading = result.current.loadSavedCart();
  });
  await act(async () => {
    expect(await result.current.link('keep_current')).toBe(false);
  });
  expect(linkAccountCart).not.toHaveBeenCalled();
  await act(async () => {
    finish({ ok: true, cart: null });
    await loading;
  });
  expect(result.current.savedCartLoaded).toBe(true);
});
it('requires a successful retry after a failed read and acknowledges an explicitly empty saved cart', async () => {
  vi.mocked(fetchSavedAccountCart)
    .mockResolvedValueOnce({
      ok: false,
      code: 'temporarily_unavailable',
      retryable: true,
    })
    .mockResolvedValue({ ok: true, cart: null });
  vi.mocked(linkAccountCart).mockResolvedValue({
    ok: false,
    code: 'temporarily_unavailable',
    retryable: true,
    snapshot: null,
  });
  const { result } = renderHook(() =>
    useCartAccountLink({ merchantSlug: 'shop', ownerSubject: 'user-a' })
  );
  await act(async () => result.current.loadSavedCart());
  await act(async () => {
    expect(await result.current.link('keep_current')).toBe(false);
  });
  expect(linkAccountCart).not.toHaveBeenCalled();
  await act(async () => result.current.loadSavedCart());
  await act(async () => {
    await result.current.link('keep_current');
  });
  expect(linkAccountCart).toHaveBeenCalledWith(
    expect.objectContaining({ expectedSavedCartId: null }),
    'shop'
  );
});
it.each([
  { shop: 'a', user: 'b' },
  { shop: 'b', user: 'a' },
])('does not use a delayed saved-cart observation after scope changes to %j', async (next) => {
  let finish: (
    value: Awaited<ReturnType<typeof fetchSavedAccountCart>>
  ) => void = () => {};
  vi.mocked(fetchSavedAccountCart).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { result, rerender } = renderHook(
    ({ shop, user }) =>
      useCartAccountLink({ merchantSlug: shop, ownerSubject: user }),
    { initialProps: { shop: 'a', user: 'a' } }
  );
  let loading: Promise<void>;
  act(() => {
    loading = result.current.loadSavedCart();
  });
  rerender(next);
  await act(async () => {
    finish({ ok: true, cart: saved });
    await loading;
  });
  expect(result.current.savedCartLoaded).toBe(false);
  expect(result.current.savedCart).toBeNull();
  await act(async () => {
    expect(await result.current.link('keep_current')).toBe(false);
  });
  expect(linkAccountCart).not.toHaveBeenCalled();
});

it('passes the successfully loaded saved-cart identity when choosing the saved cart', async () => {
  const { result } = renderHook(() =>
    useCartAccountLink({ merchantSlug: 'shop', ownerSubject: 'user-a' })
  );
  await act(async () => result.current.loadSavedCart());
  await act(async () => {
    await result.current.link('use_saved');
  });
  expect(linkAccountCart).toHaveBeenCalledWith(
    expect.objectContaining({
      choice: 'use_saved',
      expectedSavedCartId: 'saved',
    }),
    'shop'
  );
});

function useAutoLoadedAccount(onLinked?: () => void) {
  const account = useCartAccountLink({
    merchantSlug: 'shop',
    ownerSubject: 'user-a',
    onLinked,
  });
  const { loadSavedCart, scopeKey } = account;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Mirror the component's authority-scope reload trigger.
  useEffect(() => {
    void loadSavedCart();
  }, [loadSavedCart, scopeKey]);
  return account;
}
it('reloads the saved account after successful linking resets the cart generation', async () => {
  vi.mocked(linkAccountCart).mockResolvedValue({
    ok: true,
    snapshot: saved,
    replayed: false,
    warnings: [],
  });
  const { result } = renderHook(() =>
    useAutoLoadedAccount(() => {
      bumpCartSessionGeneration();
    })
  );
  await act(async () => {});
  expect(result.current.savedCartLoaded).toBe(true);
  await act(async () => {
    expect(await result.current.link('keep_current')).toBe(true);
  });
  expect(fetchSavedAccountCart).toHaveBeenCalledTimes(2);
  expect(result.current.savedCartLoaded).toBe(true);
  expect(result.current.status).toBe('ready');
});
it('loads successfully after StrictMode replays effect setup and cleanup', async () => {
  const { result } = renderHook(() => useAutoLoadedAccount(), {
    wrapper: ({ children }) => createElement(StrictMode, null, children),
  });
  await act(async () => {});
  expect(result.current.savedCartLoaded).toBe(true);
  expect(result.current.savedCart?.cartId).toBe('saved');
  await act(async () => {
    await result.current.link('use_saved');
  });
  expect(linkAccountCart).toHaveBeenCalledWith(
    expect.objectContaining({ expectedSavedCartId: 'saved' }),
    'shop'
  );
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
