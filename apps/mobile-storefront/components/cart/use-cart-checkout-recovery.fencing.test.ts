import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { CheckoutCartState } from '@/lib/cart/prepare-cart-checkout';
import { markSharedCartIntent } from '@/stores/shared-cart-writer';
import { useCartCheckoutRecovery } from './use-cart-checkout-recovery';

let mockState: CheckoutCartState;
jest.mock('@/stores/native-shared-cart-store', () => ({
  useNativeSharedCartStore: { getState: () => mockState },
}));
let mockFocused = true;
jest.mock('expo-router', () => ({
  useIsFocused: () => mockFocused,
}));
let mockAuthUser: { id: string } | null = null;
jest.mock('@/hooks/use-auth-guard', () => ({
  useAuthStatus: () => ({ user: mockAuthUser }),
}));
const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
beforeEach(() => {
  mockFocused = true;
  mockAuthUser = null;
  alert.mockClear();
  mockState = {
    enabled: true,
    status: 'ready',
    metadataReady: false,
    snapshot: null,
    prepare: jest.fn(),
    refresh: jest.fn(),
  };
});
function pendingPrepare() {
  let finish!: () => void;
  mockState.prepare = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = () => {
          mockState = {
            ...mockState,
            metadataReady: true,
            snapshot: { state: 'active', lines: [{}] },
          };
          resolve();
        };
      })
  );
  return () => finish();
}
it('shows retry guidance instead of an unhandled rejection when navigation throws', async () => {
  mockState = {
    ...mockState,
    metadataReady: true,
    snapshot: { state: 'active', lines: [{}] },
  };
  const next = jest.fn(() => {
    throw new Error('router unavailable');
  });
  const { result } = renderHook(() => useCartCheckoutRecovery(next));
  await act(async () => {
    await expect(result.current.recoverCheckout()).resolves.toBeUndefined();
  });
  expect(next).toHaveBeenCalledTimes(1);
  expect(result.current.isPreparing).toBe(false);
  expect(alert).toHaveBeenCalledWith(
    'Could not sync cart',
    expect.stringContaining('tap Checkout to retry')
  );
});
it('does not navigate when the signed-in account changes during sync', async () => {
  const finish = pendingPrepare();
  const next = jest.fn();
  const { result, rerender } = renderHook(
    ({ next }: { next: () => void }) => useCartCheckoutRecovery(next),
    { initialProps: { next } }
  );
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.recoverCheckout();
  });
  // Auth commits synchronously while controller replacement lags in a
  // passive effect, so the old controller still looks current here.
  mockAuthUser = { id: 'user-2' };
  rerender({ next });
  await act(async () => {
    finish();
    await pending;
  });
  expect(next).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(
    'Cart session changed',
    expect.stringContaining('Checkout again')
  );
});
it('does not navigate or alert after the cart route loses focus during sync', async () => {
  const finish = pendingPrepare();
  const next = jest.fn();
  const { result, rerender } = renderHook(
    ({ next }: { next: () => void }) => useCartCheckoutRecovery(next),
    { initialProps: { next } }
  );
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.recoverCheckout();
  });
  mockFocused = false;
  rerender({ next });
  await act(async () => {
    finish();
    await pending;
  });
  expect(next).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
  expect(result.current.isPreparing).toBe(false);
});
it('does not navigate ahead of a direct merge, account, or pairing choice', async () => {
  const finish = pendingPrepare();
  const next = jest.fn();
  const { result } = renderHook(() => useCartCheckoutRecovery(next));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.recoverCheckout();
  });
  markSharedCartIntent();
  await act(async () => {
    finish();
    await pending;
  });
  expect(next).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(
    'Cart changed',
    expect.stringContaining('Checkout again')
  );
});
it('does not navigate when a polling refresh publishes a new cart version during sync', async () => {
  mockState = {
    ...mockState,
    metadataReady: false,
    snapshot: { state: 'active', lines: [{}], cartId: 'cart-1', version: 1 },
  };
  let finish!: () => void;
  mockState.refresh = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = () => {
          mockState = {
            ...mockState,
            metadataReady: true,
            snapshot: {
              state: 'active',
              lines: [{}],
              cartId: 'cart-1',
              version: 2,
            },
          };
          resolve();
        };
      })
  );
  const next = jest.fn();
  const { result } = renderHook(() => useCartCheckoutRecovery(next));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.recoverCheckout();
  });
  await act(async () => {
    finish();
    await pending;
  });
  expect(next).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(
    'Cart changed',
    expect.stringContaining('Checkout again')
  );
});
