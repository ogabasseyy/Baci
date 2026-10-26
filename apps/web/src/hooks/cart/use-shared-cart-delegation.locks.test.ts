import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const locks = vi.hoisted(() => ({ supported: true }));
vi.mock('./cart-cross-tab-lock', () => ({
  isCartCrossTabLockSupported: () => locks.supported,
}));
vi.mock('./shared-cart-storage', () => ({
  getCartSessionGeneration: () => 1,
  subscribeCartSessionGeneration: () => () => {},
}));
vi.mock('./use-shared-cart', () => ({
  useSharedCart: (options: unknown) => options,
}));

import { useSharedCartDelegation } from './use-shared-cart-delegation';

const baseInput = {
  sharedCartEnabled: true,
  sharedCartRealtimeEnabled: true,
  merchantId: 'merchant-1',
  merchantSlug: 'ogabassey',
  initialMerchantSlug: 'ogabassey',
};
it('stays on the legacy cart when cross-tab locks are unavailable', () => {
  locks.supported = false;
  const { result } = renderHook(() => useSharedCartDelegation(baseInput));
  expect(result.current.delegated).toBe(false);
  locks.supported = true;
  const enabled = renderHook(() => useSharedCartDelegation(baseInput));
  expect(enabled.result.current.delegated).toBe(true);
});
