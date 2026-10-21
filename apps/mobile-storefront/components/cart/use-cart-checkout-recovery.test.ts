import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { CheckoutCartState } from '@/lib/cart/prepare-cart-checkout';
import { useCartCheckoutRecovery } from './use-cart-checkout-recovery';

let mockDeferPassive = false;
jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useEffect: (
      effect: import('react').EffectCallback,
      deps?: import('react').DependencyList
    ) =>
      actual.useEffect(() => {
        if (!mockDeferPassive) return effect();
      }, deps),
  };
});
let mockState: CheckoutCartState;
jest.mock('@/stores/native-shared-cart-store', () => ({
  useNativeSharedCartStore: { getState: () => mockState },
}));
const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
beforeEach(() => {
  mockDeferPassive = false;
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
it('deduplicates repeated taps and navigates only after the canonical cart is ready', async () => {
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
  const next = jest.fn();
  const { result } = renderHook(() => useCartCheckoutRecovery(next));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.recoverCheckout();
    void result.current.recoverCheckout();
  });
  expect(result.current.isPreparing).toBe(true);
  expect(mockState.prepare).toHaveBeenCalledTimes(1);
  expect(next).not.toHaveBeenCalled();
  await act(async () => {
    finish();
    await pending;
  });
  expect(result.current.isPreparing).toBe(false);
  expect(next).toHaveBeenCalledTimes(1);
  expect(alert).not.toHaveBeenCalled();
});
it('keeps items parked and shows actionable retry guidance on failure', async () => {
  mockState.prepare = jest.fn().mockRejectedValue(new Error('offline'));
  const next = jest.fn();
  const { result } = renderHook(() => useCartCheckoutRecovery(next));
  await act(async () => {
    await result.current.recoverCheckout();
  });
  expect(next).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(
    'Could not sync cart',
    expect.stringContaining('tap Checkout to retry')
  );
});
it('does not navigate after the cart screen unmounts during preparation', async () => {
  let finish!: () => void;
  mockState.prepare = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const next = jest.fn();
  const { result, unmount } = renderHook(() => useCartCheckoutRecovery(next));
  const pending = result.current.recoverCheckout();
  unmount();
  await act(async () => {
    finish();
    await pending;
  });
  expect(next).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
});
it('uses the latest committed navigation callback when sign-in changes during sync', async () => {
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
  const guest = jest.fn();
  const signedIn = jest.fn();
  const { result, rerender } = renderHook(
    ({ next }: { next: () => void }) => useCartCheckoutRecovery(next),
    { initialProps: { next: guest } }
  );
  const pending = result.current.recoverCheckout();
  rerender({ next: signedIn });
  await act(async () => {
    finish();
    await pending;
  });
  expect(guest).not.toHaveBeenCalled();
  expect(signedIn).toHaveBeenCalledTimes(1);
});
it('explains how to retry when a mounted cart session changes', async () => {
  mockState.prepare = jest.fn(async () => {
    mockState = { ...mockState, prepare: jest.fn() };
    throw new Error('session_changed');
  });
  const next = jest.fn();
  const { result } = renderHook(() => useCartCheckoutRecovery(next));
  await act(async () => {
    await result.current.recoverCheckout();
  });
  expect(next).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(
    'Cart session changed',
    expect.stringContaining('Checkout again')
  );
});

it('publishes navigation at commit even when passive effects are deferred', async () => {
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
  const oldNext = jest.fn();
  const newNext = jest.fn();
  const { result, rerender } = renderHook(
    ({ next }: { next: () => void }) => useCartCheckoutRecovery(next),
    { initialProps: { next: oldNext } }
  );
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.recoverCheckout();
  });
  mockDeferPassive = true;
  try {
    rerender({ next: newNext });
    await act(async () => {
      finish();
      await pending;
    });
    expect(oldNext).not.toHaveBeenCalled();
    expect(newNext).toHaveBeenCalledTimes(1);
  } finally {
    mockDeferPassive = false;
  }
});
