import { renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { getCartFromStorage } from './cart-storage';
import { fetchSharedCartSnapshot } from './shared-cart-client';
import { cartItem, snapshot } from './shared-cart-provisioning.test-support';
import { useCartLinkPolling } from './use-cart-link-polling';

vi.mock('./shared-cart-client', () => ({
  fetchSharedCartSnapshot: vi.fn(),
}));
vi.mock('./cart-storage', () => ({
  getCartFromStorage: vi.fn(() => []),
  getSharedCartImportReceipt: vi.fn(() => null),
}));
vi.mock('./shared-cart-hook-support', () => ({
  FALLBACK_POLL_MS: 1,
  RECONCILE_POLL_MS: 1,
  jittered: (ms: number) => ms,
}));

function context(overrides: Record<string, unknown> = {}) {
  return {
    dispatch: vi.fn(),
    enabled: true,
    ensureCart: vi.fn(),
    generationRef: { current: 1 },
    hydrateMissing: vi.fn(),
    lastFetchRef: { current: 0 },
    optionsRef: { current: { merchantSlug: 'shop' } },
    realtimeConnected: true,
    sessionGeneration: 1,
    state: { cartId: 'cart-1' },
    stateRef: { current: { confirmed: snapshot() } },
    surfaceActive: true,
    ...overrides,
  };
}

it('does not poll when disabled or without a cart id', () => {
  renderHook(() => useCartLinkPolling(context({ enabled: false }) as never));
  renderHook(() =>
    useCartLinkPolling(context({ state: { cartId: null } }) as never)
  );
  expect(fetchSharedCartSnapshot).not.toHaveBeenCalled();
});

it('does not poll while the surface is inactive', () => {
  renderHook(() =>
    useCartLinkPolling(context({ surfaceActive: false }) as never)
  );
  expect(fetchSharedCartSnapshot).not.toHaveBeenCalled();
});

it('replays a retryable terminal provisioning failure', async () => {
  const terminal = snapshot({ state: 'completed' });
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: true,
    snapshot: terminal,
    warnings: [],
  } as never);
  vi.mocked(getCartFromStorage).mockReturnValue([cartItem()] as never);
  const ensureCart = vi
    .fn()
    .mockResolvedValueOnce({
      ok: false,
      code: 'temporarily_unavailable',
      retryable: true,
    })
    .mockResolvedValueOnce({
      ok: false,
      code: 'temporarily_unavailable',
      retryable: true,
    })
    .mockResolvedValue({ ok: true });
  renderHook(() =>
    useCartLinkPolling(
      context({
        ensureCart,
        stateRef: { current: { confirmed: terminal } },
      }) as never
    )
  );
  await waitFor(() =>
    expect(ensureCart.mock.calls.length).toBeGreaterThanOrEqual(3)
  );
});

it('fails the import when terminal provisioning exhausts its retries', async () => {
  const terminal = snapshot({ state: 'completed' });
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: true,
    snapshot: terminal,
    warnings: [],
  } as never);
  vi.mocked(getCartFromStorage).mockReturnValue([cartItem()] as never);
  const dispatch = vi.fn();
  const ensureCart = vi.fn().mockResolvedValue({
    ok: false,
    code: 'temporarily_unavailable',
    retryable: true,
  });
  renderHook(() =>
    useCartLinkPolling(
      context({
        dispatch,
        ensureCart,
        stateRef: { current: { confirmed: terminal } },
      }) as never
    )
  );
  await waitFor(() =>
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'import/failed' })
    )
  );
});
