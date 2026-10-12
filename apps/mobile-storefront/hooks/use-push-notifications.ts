import { useEffect, useEffectEvent, useRef } from 'react';
import { Platform } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { CONFIG } from '@/lib/config';
import { getNativePushRegistration } from '@/lib/hosted-staging-push-capability';
import { createLogger } from '@/lib/logger';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { savingsNotificationEvents } from '@/services/savings-notification-events';
import { getSavingsPushNavigationTarget } from '@/services/savings-push-navigation';
import { invalidateSavingsWalletCache } from '@/services/savings-wallet-cache';
import { useAuthStore } from '@/stores/auth-store';
import { clearLastNotificationResponse } from './clear-last-notification-response';
import { navigateFromPushScreen } from './navigate-from-push-screen';
import { processPushNotificationResponse } from './process-push-notification-response';
import type { UsePushNotificationsReturn } from './use-push-notifications.types';
import { useSavingsPushRegistration } from './use-savings-push-registration';

type EventSubscription = {
  remove: () => void;
};

const STOREFRONT_MERCHANT_ID = pickMerchantId(CONFIG.MERCHANT_ID);
const log = createLogger('PushNotifications');

let Notifications: typeof import('expo-notifications') | null = null;

const loadNativeModules = async () => {
  if (Platform.OS === 'web') return;
  if (!getNativePushRegistration()) return;
  try {
    Notifications = await import('expo-notifications');
  } catch (error) {
    if (__DEV__) {
      console.debug(
        '[PushHook] Notifications module ignored or failed to load:',
        error
      );
    }
  }
};

const notificationsReady = loadNativeModules();

export function usePushNotifications(): UsePushNotificationsReturn {
  const { customer, user, merchantId } = useAuthStore(
    useShallow((state) => ({
      customer: state.customer,
      user: state.user,
      merchantId: state.merchantId,
    }))
  );
  const notificationListener = useRef<EventSubscription | null>(null);
  const responseListener = useRef<EventSubscription | null>(null);
  const registration = useSavingsPushRegistration();
  const activeMerchantId = pickMerchantId(merchantId, STOREFRONT_MERCHANT_ID);

  const navigate = useEffectEvent(
    (
      screen: string,
      params?: Record<string, string>,
      isCurrent?: () => boolean
    ) => navigateFromPushScreen(screen, params, isCurrent)
  );
  const invalidateSavingsWallet = useEffectEvent(() =>
    invalidateSavingsWalletCache({
      merchantId: activeMerchantId,
      ownerId: customer?.id ?? user?.id ?? null,
    })
  );
  const receiveSavingsNotification = useEffectEvent((payload: unknown) => {
    const auth = useAuthStore.getState();
    const currentMerchantId = pickMerchantId(
      auth.merchantId,
      STOREFRONT_MERCHANT_ID
    );
    if (
      !auth.user ||
      !currentMerchantId ||
      !getSavingsPushNavigationTarget(payload, currentMerchantId)
    )
      return;
    savingsNotificationEvents.publish({
      merchantId: currentMerchantId,
      userId: auth.user.id,
    });
    void invalidateSavingsWalletCache({
      merchantId: currentMerchantId,
      ownerId: auth.customer?.id ?? auth.user.id,
    }).catch(() => log.warn('Unable to refresh savings after notification'));
  });

  useEffect(() => {
    const cancelledRef = { current: false };

    notificationsReady.then(() => {
      if (cancelledRef.current || !Notifications) return;

      notificationListener.current?.remove();
      responseListener.current?.remove();
      notificationListener.current =
        Notifications.addNotificationReceivedListener((notification) => {
          log.info('Notification received');
          receiveSavingsNotification(notification.request.content.data);
        });
      responseListener.current =
        Notifications.addNotificationResponseReceivedListener((response) => {
          log.info('Notification tapped');
          processPushNotificationResponse(
            response,
            navigate,
            () => clearLastNotificationResponse(Notifications),
            { activeMerchantId, invalidateSavingsWallet }
          );
        });

      Notifications.getLastNotificationResponseAsync().then((response) => {
        if (response && !cancelledRef.current) {
          log.info('App launched from notification');
          processPushNotificationResponse(
            response,
            navigate,
            () => clearLastNotificationResponse(Notifications),
            { activeMerchantId, invalidateSavingsWallet }
          );
        }
      });
    });

    return () => {
      cancelledRef.current = true;
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [activeMerchantId]);

  return registration;
}
