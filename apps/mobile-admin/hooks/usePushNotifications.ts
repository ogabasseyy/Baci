/**
 * usePushNotifications Hook
 * Manages push notification registration and listeners for the admin app
 *
 * Usage:
 * const { token, isRegistered, registerPush, unregisterPush } = usePushNotifications();
 */

import type * as DeviceType from 'expo-device';
import type {
  EventSubscription,
  Notification as ExpoNotification,
  NotificationResponse as ExpoNotificationResponse,
} from 'expo-notifications';
import { isRuntimePlatform } from '@/config/runtime-platform';
import { asyncStorage as AsyncStorage } from '@/lib/storage';

// Dynamic imports for native modules to prevent evaluation-time crashes.
let Device: typeof DeviceType | null = null;
let Notifications: typeof import('expo-notifications') | null = null;

async function loadNotificationsForDevice() {
  if (Notifications || isRuntimePlatform('web')) {
    return Notifications;
  }

  try {
    Device = await import('expo-device');

    if (!Device?.isDevice) {
      if (__DEV__) {
        console.log('[PushHook] Native notifications skipped on simulator');
      }
      return null;
    }

    Notifications = await import('expo-notifications');
    return Notifications;
  } catch (_e) {
    console.debug('[PushHook] Native module ignored during evaluation');
    return null;
  }
}

import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { registerChatReplyCategory } from '@/services/chat-notification-reply';
import {
  clearBadge,
  registerForPushNotifications,
  removePushTokenFromServer,
  savePushTokenToServer,
} from '@/services/push-notifications';
import { handleNotificationTap } from './push-notification-navigation';
import { useMerchant } from './useMerchant';

const PUSH_TOKEN_STORAGE_KEY = '@baci_push_token';

/**
 * Fetch a push token, persist it on the server and locally, and report the
 * registered token through `onRegistered`. Errors are swallowed after logging
 * so callers can treat completion as "registration attempt finished".
 */
async function performPushRegistration(
  merchantId: string,
  onRegistered: (pushToken: string) => void
): Promise<void> {
  try {
    // Get the push token
    const pushToken = await registerForPushNotifications();

    if (!pushToken) {
      if (__DEV__) {
        console.log('[Push] Registration failed - no token received');
      }
      return;
    }

    // Save to server. The RPC derives user ownership from the current
    // authenticated Supabase session; callers only provide merchant scope.
    const saved = await savePushTokenToServer(pushToken, merchantId);

    if (saved) {
      // Store locally for logout cleanup
      await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, pushToken);
      onRegistered(pushToken);
      if (__DEV__) {
        console.log('[Push] Registration complete');
      }
    }
  } catch (error) {
    console.error('[Push] Registration error:', error);
  }
}

interface UsePushNotificationsResult {
  token: string | null;
  isRegistered: boolean;
  isLoading: boolean;
  registerPush: (merchantId?: string) => Promise<void>;
  unregisterPush: () => Promise<void>;
}

export function usePushNotifications(): UsePushNotificationsResult {
  const [token, setToken] = useState<string | null>(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const { merchant } = useMerchant();
  const router = useRouter();

  // Refs for notification listeners
  const notificationListener = useRef<EventSubscription | null>(null);
  const responseListener = useRef<EventSubscription | null>(null);

  /**
   * Register for push notifications.
   * Accepts an explicit merchantId so layout code can pass the merchant that
   * triggered registration; user ownership is derived by the server RPC from
   * the current authenticated Supabase session.
   */
  async function registerPush(merchantId?: string) {
    const resolvedMerchantId = merchantId ?? merchant?.id;

    if (!resolvedMerchantId) {
      if (__DEV__) {
        console.log('[Push] Cannot register: missing merchant');
      }
      return;
    }

    setIsLoading(true);

    // performPushRegistration never rejects, so loading always resets.
    await performPushRegistration(resolvedMerchantId, (pushToken) => {
      setToken(pushToken);
      setIsRegistered(true);
    });

    setIsLoading(false);
  }

  /**
   * Unregister push notifications (call on logout)
   */
  async function unregisterPush() {
    try {
      // Get stored token
      const storedToken = await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY);

      if (storedToken) {
        await removePushTokenFromServer(storedToken);
        await AsyncStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
      }

      setToken(null);
      setIsRegistered(false);
      if (__DEV__) {
        console.log('[Push] Unregistered');
      }
    } catch (error) {
      console.error('[Push] Unregister error:', error);
    }
  }

  /**
   * Set up notification listeners
   */
  useEffect(() => {
    let cancelled = false;

    void loadNotificationsForDevice().then((loadedNotifications) => {
      if (cancelled || !loadedNotifications) {
        return;
      }

      // The Reply box on chat notifications. Best effort: without it the
      // notification still opens the chat. Logged in production too, like the
      // other push errors.
      void registerChatReplyCategory(loadedNotifications).catch((error) => {
        console.error('[Push] Failed to register the chat Reply box:', error);
      });

      // Listener for notifications received while app is foregrounded
      notificationListener.current =
        loadedNotifications.addNotificationReceivedListener(
          (notification: ExpoNotification) => {
            if (__DEV__) {
              console.log(
                '[Push] Notification received:',
                notification.request.content.title
              );
            }
            // You can show an in-app toast here if desired
          }
        );

      // Listener for when user taps on a notification
      responseListener.current =
        loadedNotifications.addNotificationResponseReceivedListener(
          (response: ExpoNotificationResponse) => {
            if (__DEV__) {
              console.log('[Push] Notification tapped');
            }

            // Clear badge on interaction
            void clearBadge();
            handleNotificationTap(router, response);
          }
        );

      loadedNotifications
        .getLastNotificationResponseAsync?.()
        .then((response) => {
          if (cancelled || !response) {
            return;
          }

          void clearBadge();
          handleNotificationTap(router, response);
        })
        .catch((error) => {
          if (__DEV__) {
            console.debug('[Push] Failed to get last notification:', error);
          }
        });
    });

    // Cleanup listeners on unmount
    return () => {
      cancelled = true;
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, [router]);

  /**
   * Load cached token on mount for display, but always allow fresh
   * registration. AsyncStorage persists across TestFlight/App Store
   * updates, so a stale token would block re-registration forever.
   */
  useEffect(() => {
    void (async () => {
      try {
        const storedToken = await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
        if (storedToken) {
          setToken(storedToken);
        }
      } catch (error) {
        if (__DEV__) {
          console.debug('[Push] Failed to load cached token:', error);
        }
      }
    })();
  }, []);

  return {
    token,
    isRegistered,
    isLoading,
    registerPush,
    unregisterPush,
  };
}
