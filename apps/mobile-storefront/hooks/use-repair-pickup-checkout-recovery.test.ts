import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  mockSessionClear,
  mockSessionLoad,
  mockSessionSave,
  pickupRequestFixture,
  pickupSessionFixture,
  primeRepairPickupCheckoutMocks,
} from './use-repair-pickup-checkout.test-utils';
import { useRepairPickupCheckoutRecovery } from './use-repair-pickup-checkout-recovery';

// jest.mock is hoisted above every import, so the hook under test binds to
// these mocks rather than the real secure-storage modules. The factories
// reference the imported `mock*` singletons (allowed by
// babel-plugin-jest-hoist) and only invoke them at call time, once the
// test-utils bindings have initialized.
jest.mock('@/lib/repair-pickup-session', () => ({
  repairPickupSession: {
    clear: (...args: unknown[]) => mockSessionClear(...args),
    load: (...args: unknown[]) => mockSessionLoad(...args),
    save: (...args: unknown[]) => mockSessionSave(...args),
  },
}));

describe('useRepairPickupCheckoutRecovery', () => {
  beforeEach(() => {
    primeRepairPickupCheckoutMocks();
  });

  it('starts unrestored then becomes ready with the saved session', async () => {
    mockSessionLoad.mockResolvedValue(pickupSessionFixture);
    const { result } = renderHook(() =>
      useRepairPickupCheckoutRecovery(pickupRequestFixture)
    );

    expect(result.current.ready).toBe(false);
    expect(result.current.saved).toBeNull();

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.saved).toEqual(pickupSessionFixture);
    expect(result.current.restoreFailed).toBe(false);
    expect(mockSessionLoad).toHaveBeenCalledWith(pickupRequestFixture);
  });

  it('becomes ready with no saved session when storage is empty', async () => {
    const { result } = renderHook(() =>
      useRepairPickupCheckoutRecovery(pickupRequestFixture)
    );

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.saved).toBeNull();
    expect(result.current.restoreFailed).toBe(false);
  });

  it('flags restore failure when secure storage throws', async () => {
    mockSessionLoad.mockRejectedValue(new Error('storage locked'));
    const { result } = renderHook(() =>
      useRepairPickupCheckoutRecovery(pickupRequestFixture)
    );

    await waitFor(() => expect(result.current.restoreFailed).toBe(true));
    expect(result.current.ready).toBe(false);
  });

  it('retry clears the failure and reloads the session', async () => {
    mockSessionLoad.mockRejectedValueOnce(new Error('storage locked'));
    mockSessionLoad.mockResolvedValue(pickupSessionFixture);
    const { result } = renderHook(() =>
      useRepairPickupCheckoutRecovery(pickupRequestFixture)
    );

    await waitFor(() => expect(result.current.restoreFailed).toBe(true));

    act(() => {
      result.current.retryRestore();
    });

    expect(result.current.restoreFailed).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.saved).toEqual(pickupSessionFixture);
    expect(mockSessionLoad).toHaveBeenCalledTimes(2);
  });
});
