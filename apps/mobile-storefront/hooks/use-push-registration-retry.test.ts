import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { usePushRegistrationRetry } from './use-push-registration-retry';

describe('usePushRegistrationRetry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('waits until initialization and ATT settlement before registering', () => {
    const registerPushNotifications = jest.fn();
    const { rerender } = renderHook(
      ({ settled }: { settled: boolean }) =>
        usePushRegistrationRetry({
          isInitialized: true,
          isTrackingAuthorizationSettled: settled,
          storeUserId: 'user-1',
          storeMerchantId: 'merchant-1',
          isPushRegistered: false,
          registeredUserId: null,
          isPushLoading: false,
          registerPushNotifications,
        }),
      { initialProps: { settled: false } }
    );

    expect(registerPushNotifications).not.toHaveBeenCalled();

    rerender({ settled: true });
    expect(registerPushNotifications).toHaveBeenCalledWith(
      'user-1',
      'merchant-1'
    );
  });

  it('caps attempts at 3 per session and resets on logout', () => {
    const registerPushNotifications = jest.fn();
    const { rerender } = renderHook(
      ({ userId, loading }: { userId: string | null; loading: boolean }) =>
        usePushRegistrationRetry({
          isInitialized: true,
          isTrackingAuthorizationSettled: true,
          storeUserId: userId,
          storeMerchantId: undefined,
          isPushRegistered: false,
          registeredUserId: null,
          isPushLoading: loading,
          registerPushNotifications,
        }),
      { initialProps: { userId: 'user-1' as string | null, loading: false } }
    );

    expect(registerPushNotifications).toHaveBeenCalledTimes(1);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      rerender({ userId: 'user-1', loading: true });
      rerender({ userId: 'user-1', loading: false });
    }
    expect(registerPushNotifications).toHaveBeenCalledTimes(3);

    rerender({ userId: null, loading: false });
    rerender({ userId: 'user-1', loading: false });
    expect(registerPushNotifications).toHaveBeenCalledTimes(4);
  });
});
