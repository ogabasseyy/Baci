import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseSharedCart = vi.fn();
let generationListener: (() => void) | null = null;

vi.mock('./shared-cart-storage', () => ({
  getCartSessionGenerationChange: () => undefined,
  subscribeCartSessionGeneration: (listener: () => void) => {
    generationListener = listener;
    return () => {
      generationListener = null;
    };
  },
}));

vi.mock('./use-shared-cart', () => ({
  useSharedCart: (options: unknown) => mockUseSharedCart(options),
}));

import { useSharedCartDelegation } from './use-shared-cart-delegation';

const baseInput = {
  sharedCartEnabled: true,
  sharedCartRealtimeEnabled: true,
  merchantId: 'merchant-1',
  merchantSlug: 'ogabassey',
  initialMerchantSlug: 'ogabassey',
};

describe('useSharedCartDelegation', () => {
  beforeEach(() => {
    mockUseSharedCart.mockReset();
    mockUseSharedCart.mockReturnValue({ status: 'ready' });
    generationListener = null;
  });

  it('delegates when enrollment, merchant and served slug all agree', () => {
    const { result } = renderHook(() => useSharedCartDelegation(baseInput));

    expect(result.current.delegated).toBe(true);
    expect(mockUseSharedCart).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        realtimeEnabled: true,
        sessionGeneration: 1,
      })
    );
  });

  it('stays on the legacy cart when the served slug differs or enrollment is off', () => {
    const switched = renderHook(() =>
      useSharedCartDelegation({ ...baseInput, merchantSlug: 'other-shop' })
    );
    expect(switched.result.current.delegated).toBe(false);

    const disabled = renderHook(() =>
      useSharedCartDelegation({ ...baseInput, sharedCartEnabled: false })
    );
    expect(disabled.result.current.delegated).toBe(false);
    expect(mockUseSharedCart).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false, realtimeEnabled: false })
    );
  });

  it('fences late responses by bumping the session generation', () => {
    const { result } = renderHook(() => useSharedCartDelegation(baseInput));
    expect(result.current.sessionGeneration).toBe(1);

    act(() => {
      result.current.bumpSessionGeneration();
    });
    expect(result.current.sessionGeneration).toBe(2);

    act(() => {
      generationListener?.();
    });
    expect(result.current.sessionGeneration).toBe(3);
    expect(mockUseSharedCart).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionGeneration: 3 })
    );
  });
});
