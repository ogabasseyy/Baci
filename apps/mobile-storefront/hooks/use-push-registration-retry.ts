import { useEffect, useRef } from 'react';

interface UsePushRegistrationRetryOptions {
  isInitialized: boolean;
  isTrackingAuthorizationSettled: boolean;
  storeUserId?: string | null;
  storeMerchantId?: string | null;
  isPushRegistered: boolean;
  registeredUserId?: string | null;
  isPushLoading: boolean;
  registerPushNotifications: (userId: string, merchantId?: string) => unknown;
}

/**
 * Registers push notifications once auth and ATT settlement complete,
 * retrying up to 3 times per user session and resetting attempts on logout.
 */
export function usePushRegistrationRetry({
  isInitialized,
  isTrackingAuthorizationSettled,
  storeUserId,
  storeMerchantId,
  isPushRegistered,
  registeredUserId,
  isPushLoading,
  registerPushNotifications,
}: UsePushRegistrationRetryOptions) {
  const pushAttemptsRef = useRef<{ userId: string | null; count: number }>({
    userId: null,
    count: 0,
  });

  const isPushRegisteredForCurrentUser = Boolean(
    storeUserId && isPushRegistered && registeredUserId === storeUserId
  );

  // Clear attempt tracking on logout so the same account can re-register
  // after signing out and back in.
  useEffect(() => {
    if (!storeUserId) {
      pushAttemptsRef.current = { userId: null, count: 0 };
    }
  }, [storeUserId]);

  useEffect(() => {
    const maxAttempts = 3;
    const ref = pushAttemptsRef.current;
    const isNewUser = ref.userId !== storeUserId;
    const attemptsLeft = isNewUser || ref.count < maxAttempts;

    if (
      isInitialized &&
      isTrackingAuthorizationSettled &&
      storeUserId &&
      !isPushRegisteredForCurrentUser &&
      !isPushLoading &&
      attemptsLeft
    ) {
      if (isNewUser) {
        pushAttemptsRef.current = { userId: storeUserId, count: 1 };
      } else {
        pushAttemptsRef.current.count += 1;
      }
      void registerPushNotifications(storeUserId, storeMerchantId ?? undefined);
    }
  }, [
    isInitialized,
    isPushRegisteredForCurrentUser,
    isPushLoading,
    isTrackingAuthorizationSettled,
    registerPushNotifications,
    storeUserId,
    storeMerchantId,
  ]);
}
