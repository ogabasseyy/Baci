import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useStorefrontCartDelegation } from './use-storefront-cart-delegation';

const composed = vi.hoisted(() => ({
  delegation: vi.fn(),
  transitions: vi.fn(),
  actions: vi.fn(),
}));

vi.mock('./use-shared-cart-delegation', () => ({
  useSharedCartDelegation: composed.delegation,
}));
vi.mock('./use-cart-delegation-transitions', () => ({
  useCartDelegationTransitions: composed.transitions,
}));
vi.mock('./delegated-cart-actions', () => ({
  createDelegatedCartActions: composed.actions,
}));

const shared = { marker: 'shared-runtime' };
const delegatedActions = { marker: 'delegated-actions' };

function input() {
  return {
    sharedCartEnabled: true,
    sharedCartRealtimeEnabled: false,
    merchantId: 'merchant-1',
    merchantSlug: 'shop',
    initialMerchantSlug: 'shop',
    isHydrated: true,
    setCart: vi.fn(),
    setMerchantSlugState: vi.fn(),
    setCartWideNegotiationActiveState: vi.fn(),
    setIsHydrated: vi.fn(),
    cartWideNegotiationActiveRef: { current: false },
    setCartWideNegotiationActive: vi.fn(),
  };
}

describe('useStorefrontCartDelegation', () => {
  it('composes decision, transitions, and delegated actions when delegated', () => {
    const bumpSessionGeneration = vi.fn();
    composed.delegation.mockReturnValue({
      bumpSessionGeneration,
      delegated: true,
      shared,
    });
    composed.actions.mockReturnValue(delegatedActions);

    const { result } = renderHook(() => useStorefrontCartDelegation(input()));

    expect(result.current).toEqual({
      bumpSessionGeneration,
      delegated: true,
      delegatedActions,
      shared,
    });
    expect(composed.delegation).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        merchantSlug: 'shop',
        sharedCartEnabled: true,
      })
    );
    expect(composed.transitions).toHaveBeenCalledWith(
      expect.objectContaining({ delegated: true, shared })
    );
    expect(composed.actions).toHaveBeenCalledWith(
      shared,
      expect.objectContaining({ current: false }),
      expect.any(Function)
    );
  });

  it('passes the legacy (non-delegated) decision through unchanged', () => {
    const bumpSessionGeneration = vi.fn();
    composed.delegation.mockReturnValue({
      bumpSessionGeneration,
      delegated: false,
      shared: null,
    });
    composed.actions.mockReturnValue(delegatedActions);

    const { result } = renderHook(() => useStorefrontCartDelegation(input()));

    expect(result.current.delegated).toBe(false);
    expect(result.current.shared).toBeNull();
    expect(composed.transitions).toHaveBeenCalledWith(
      expect.objectContaining({ delegated: false, shared: null })
    );
  });
});
