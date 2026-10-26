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
        const cleanup = !mockDeferPassive ? effect() : undefined;
        return () => {
          if (!mockDeferPassive) cleanup?.();
        };
      }, deps),
  };
});
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
  mockDeferPassive = false;
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

it('fences an unmounted screen before passive cleanups run', async () => {
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
  const { result, unmount } = renderHook(() => useCartCheckoutRecovery(next));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.recoverCheckout();
  });
  mockDeferPassive = true;
  try {
    unmount();
    await act(async () => {
      finish();
      await pending;
    });
    expect(next).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  } finally {
    mockDeferPassive = false;
  }
});
it.each([
  'quantity',
  'remove',
  'clear',
] as const)('does not navigate ahead of a queued %s intent', async (type) => {
  const { installSharedCartWriter, forwardSharedCartWrite } = await import(
    '@/stores/shared-cart-writer'
  );
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
  // The controller is still preparing, so the requested edit has not run yet.
  let finishWrite!: () => void;
  const write = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finishWrite = resolve;
      })
  );
  const release = installSharedCartWriter({ write, onError: jest.fn() });
  const next = jest.fn();
  const { result } = renderHook(() => useCartCheckoutRecovery(next));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.recoverCheckout();
  });
  const edited = forwardSharedCartWrite(
    type === 'clear'
      ? { type }
      : type === 'remove'
        ? { type, id: 'line-1' }
        : { type, id: 'line-1', quantity: 2 }
  );
  try {
    await act(async () => {
      finish();
      await pending;
    });
    expect(next).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      'Cart changed',
      expect.stringContaining('Checkout again')
    );
  } finally {
    finishWrite();
    await edited;
    release();
  }
});
