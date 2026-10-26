import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { fetchSharedCartSnapshot } from './shared-cart-client';
import { snapshot } from './shared-cart-provisioning.test-support';
import { useCartLinkPolling } from './use-cart-link-polling';

vi.mock('./shared-cart-client', () => ({
  fetchSharedCartSnapshot: vi.fn(),
}));
vi.mock('./cart-storage', () => ({
  getCartFromStorage: vi.fn(() => []),
  getSharedCartImportReceipt: vi.fn(() => null),
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
