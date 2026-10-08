import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { CONFIG } from '@/lib/config';
import { getNativePushRegistration } from '@/lib/hosted-staging-push-capability';
import { createLogger } from '@/lib/logger';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import {
  clearRegisteredPushToken,
  clearStoredPushToken,
  getStoredPushToken,
  isPushOptedOut,
  setPushOptOut,
  storeLocalPushToken,
} from '@/lib/push-token-storage';
import { trackError } from '@/services/analytics';
import { ensureAndroidNotificationChannels } from '@/services/push-notification-channels';
import {
  registerForPushNotifications,
  removePushTokenFromServer,
  savePushTokenToServer,
} from '@/services/push-notifications';
import { useAuthStore } from '@/stores/auth-store';
import {
  retrySavingsPushRegistration,
  type SavingsPushRegistrationIdentity,
  savingsPushRegistrationKey,
} from './savings-push-registration';
import type { UsePushNotificationsReturn } from './use-push-notifications.types';
import { usePushTokenRefresh } from './use-push-token-refresh';
import { useSavingsReminderDelivery } from './use-savings-reminder-delivery';

const log = createLogger('PushNotifications');
const STOREFRONT_MERCHANT_ID = pickMerchantId(CONFIG.MERCHANT_ID);

export function useSavingsPushRegistration(): UsePushNotificationsReturn {
  const [pushToken, setPushTokenState] = useState<string | null>(null);
  const [registeredIdentity, setRegisteredIdentityState] =
    useState<SavingsPushRegistrationIdentity | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user, merchantId } = useAuthStore(
    useShallow((state) => ({ user: state.user, merchantId: state.merchantId }))
  );

  const tokenRef = useRef<string | null>(null);
  const registeredIdentityRef = useRef<SavingsPushRegistrationIdentity | null>(
    null
  );
  const mountedRef = useRef(false);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const merchantOverrideRef = useRef<{
    userId: string;
    authMerchantId: string | null;
    merchantId: string;
  } | null>(null);
  const activeMerchantId = pickMerchantId(merchantId, STOREFRONT_MERCHANT_ID);
  const currentKey = savingsPushRegistrationKey(
    user?.id ?? null,
    activeMerchantId,
    pushToken
  );
  const isRegistered = Boolean(
    currentKey && registeredIdentity?.key === currentKey
  );
  useSavingsReminderDelivery(user?.id ?? null, activeMerchantId, isRegistered);

  const updateToken = (token: string | null) => {
    tokenRef.current = token;
    setPushTokenState(token);
  };
  const updateIdentity = (identity: SavingsPushRegistrationIdentity | null) => {
    registeredIdentityRef.current = identity;
    setRegisteredIdentityState(identity);
  };
  const getRegistrationState = () => {
    const auth = useAuthStore.getState();
    const override = merchantOverrideRef.current;
    return {
      userId: auth.user?.id ?? null,
      merchantId: pickMerchantId(
        auth.merchantId,
        override !== null &&
          override.userId === auth.user?.id &&
          override.authMerchantId === auth.merchantId
          ? override.merchantId
          : null,
        STOREFRONT_MERCHANT_ID
      ),
      token: tokenRef.current,
      registeredKey: registeredIdentityRef.current?.key ?? null,
      isMounted: mountedRef.current,
    };
  };

  const syncRegistration = useEffectEvent(() =>
    retrySavingsPushRegistration({
      getState: getRegistrationState,
      inFlight: inFlightRef,
      pending: pendingRef,
      isEnabled: async () => getNativePushRegistration() !== null,
      prepare: async () => {
        if (Platform.OS !== 'android') return;
        try {
          await ensureAndroidNotificationChannels();
        } catch (channelError) {
          log.warn(
            'Failed to ensure Android notification channels:',
            channelError
          );
        }
      },
      hasPermission: async () => {
        const Notifications =
          require('expo-notifications') as typeof import('expo-notifications');
        const permission = await Notifications.getPermissionsAsync();
        return permission.status === 'granted';
      },
      isOptedOut: isPushOptedOut,
      save: savePushTokenToServer,
      setIdentity: updateIdentity,
      setError,
    })
  );

  const register = async (
    explicitUserId?: string,
    explicitMerchantId?: string,
    opts?: { force?: boolean }
  ) => {
    if (isLoading || isRegistered || !getNativePushRegistration()) return;
    const liveAuth = useAuthStore.getState();
    const startedAs = {
      userId: liveAuth.user?.id ?? null,
      merchantId: liveAuth.merchantId ?? null,
    };
    const authUnchanged = () => {
      const current = useAuthStore.getState();
      return (
        (current.user?.id ?? null) === startedAs.userId &&
        (current.merchantId ?? null) === startedAs.merchantId
      );
    };
    const resolvedUserId = explicitUserId ?? liveAuth.user?.id;
    const resolvedMerchantId = pickMerchantId(
      explicitMerchantId,
      liveAuth.merchantId,
      STOREFRONT_MERCHANT_ID
    );

    if (resolvedUserId) {
      if (opts?.force) {
        await setPushOptOut(resolvedUserId, false);
      } else if (await isPushOptedOut(resolvedUserId)) {
        return;
      }
    }
    if (!authUnchanged()) return;

    setIsLoading(true);
    setError(null);
    try {
      if (Platform.OS === 'android') {
        await ensureAndroidNotificationChannels();
      }

      let token = tokenRef.current || (await getStoredPushToken());
      if (!token) token = await registerForPushNotifications();
      if (!mountedRef.current) return;

      if (token) {
        if (!authUnchanged()) {
          setIsLoading(false);
          return;
        }
        merchantOverrideRef.current =
          resolvedUserId && resolvedMerchantId
            ? {
                userId: resolvedUserId,
                authMerchantId: startedAs.merchantId,
                merchantId: resolvedMerchantId,
              }
            : null;
        updateToken(token);
        await storeLocalPushToken(token);
        if (resolvedUserId && !resolvedMerchantId) {
          try {
            trackError(
              'push_token_merchant_id_unresolvable',
              'No merchant id from explicit arg, auth store, or expo config',
              { has_storefront_constant: STOREFRONT_MERCHANT_ID !== null }
            );
          } catch (trackError) {
            log.warn('Failed to track unresolvable merchantId:', trackError);
          }
        }
        await syncRegistration();
        merchantOverrideRef.current = null;
      } else {
        updateIdentity(null);
        setError('Failed to get push token');
      }
      if (mountedRef.current) setIsLoading(false);
    } catch (registerError) {
      merchantOverrideRef.current = null;
      if (mountedRef.current) {
        updateIdentity(null);
        setError(
          registerError instanceof Error
            ? registerError.message
            : 'Unknown error'
        );
        setIsLoading(false);
      }
    }
  };

  const unregister = async () => {
    const token = tokenRef.current || (await getStoredPushToken());
    await clearStoredPushToken();
    if (user?.id && activeMerchantId) {
      await clearRegisteredPushToken(user.id, activeMerchantId);
    }
    if (user?.id) await setPushOptOut(user.id, true);
    updateToken(null);
    updateIdentity(null);
    if (token) {
      const removed = await removePushTokenFromServer(token);
      if (!removed) {
        log.warn('Failed to deactivate push token on server during unregister');
      }
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pendingRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getStoredPushToken().then((stored) => {
      if (stored && !cancelled) {
        tokenRef.current = stored;
        setPushTokenState(stored);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (user?.id && pushToken && activeMerchantId && !isRegistered) {
      void syncRegistration();
    }
  }, [activeMerchantId, isRegistered, pushToken, user?.id]);

  usePushTokenRefresh({
    getState: getRegistrationState,
    retry: syncRegistration,
    onToken: async (token) => {
      updateToken(token);
      await storeLocalPushToken(token);
      await syncRegistration();
    },
  });

  useEffect(() => {
    if (!user && mountedRef.current) {
      tokenRef.current = null;
      registeredIdentityRef.current = null;
      setPushTokenState(null);
      setRegisteredIdentityState(null);
    }
  }, [user]);

  return {
    pushToken,
    isRegistered,
    registeredUserId: registeredIdentity?.userId ?? null,
    isLoading,
    error,
    register,
    unregister,
  };
}
