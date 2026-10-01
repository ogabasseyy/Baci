import { getStorefrontNotificationNavigationTarget } from '@baci/shared/lib';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import type {
  NotificationResponse,
  PermissionStatus,
} from 'expo-notifications';
import { Platform } from 'react-native';
import { requestMobileUpdateCheck } from '@/components/updates/mobile-update-events';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { ensureAndroidNotificationChannels } from '@/services/push-notification-channels';

const log = createLogger('PushNotifications');

/**
 * Parse the installed native build number (Android `versionCode`, iOS
 * `CFBundleVersion`) into a non-negative integer for update-nudge targeting,
 * or `null` when unavailable/malformed.
 *
 * Uses strict `Number(...)` (not `parseInt`) to mirror the server-side gate's
 * parser, so a partially numeric build like `646-beta` or a dotted `646.1` is
 * rejected as malformed rather than truncated to `646`. Otherwise the registered
 * build number could disagree with the build the release-policy gate honours.
 */
export function resolveNativeBuildNumber(
  value: string | null = Application.nativeBuildVersion
): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

let Device: typeof import('expo-device') | null = null;
let Notifications: typeof import('expo-notifications') | null = null;

const loadNativeModules = async () => {
  if (Platform.OS === 'web') return;
  try {
    const [dev, notif] = await Promise.all([
      import('expo-device'),
      import('expo-notifications'),
    ]);
    Device = dev;
    Notifications = notif;

    if (Notifications) {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
        }),
      });
    }
  } catch (e) {
    log.debug('Native modules ignored or failed to load:', e);
  }
};

loadNativeModules();

export interface PushNotificationState {
  token: string | null;
  isRegistered: boolean;
  permissionStatus: PermissionStatus | null;
}

export async function requestPermissions(): Promise<PermissionStatus | null> {
  if (!Notifications) return null;
  const { status: existingStatus } = await Notifications.getPermissionsAsync();

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    return status;
  }

  return existingStatus;
}

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device || !Notifications) {
    await loadNativeModules();
  }

  if (!Device || !Notifications) return null;

  if (!Device.isDevice) {
    log.warn('Push notifications require a physical device');
    return null;
  }

  const permissionStatus = await requestPermissions();

  if (permissionStatus !== 'granted') {
    log.warn('Push notification permission not granted');
    return null;
  }

  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;

    if (!projectId) {
      log.warn('EAS project ID not configured in app.json');
    }

    if (Platform.OS === 'android') {
      await ensureAndroidNotificationChannels();
    }

    const tokenResponse = await Notifications.getExpoPushTokenAsync({
      projectId: projectId || undefined,
    });

    const token = tokenResponse.data;
    log.debug('Expo Push Token:', token);

    return token;
  } catch (error) {
    log.error('Failed to get push token:', error);
    return null;
  }
}

export async function savePushTokenToServer(
  token: string,
  userId: string,
  merchantId: string
): Promise<boolean> {
  const trimmedToken = token.trim();
  const trimmedUserId = userId.trim();
  const trimmedMerchantId = merchantId.trim();

  if (!trimmedToken || !trimmedUserId || !trimmedMerchantId) {
    log.error('Refusing to save push token: empty token/userId/merchantId');
    return false;
  }

  try {
    // Register via the SECURITY DEFINER RPC instead of a raw upsert. Expo push
    // tokens are device-unique, so when a different account signs in on the same
    // device the upsert's UPDATE branch (on conflict: token) hits a row still
    // owned by the previous user_id and is blocked by RLS (42501). The RPC
    // re-claims the token for the authenticated caller atomically.
    const { error } = await supabase.rpc('register_push_token', {
      p_token: trimmedToken,
      p_merchant_id: trimmedMerchantId,
      p_platform: Platform.OS,
      p_device_name: Device?.modelName || 'Unknown',
      p_app_type: 'storefront',
      p_build_number: resolveNativeBuildNumber(),
      p_shipment_update_capability: 1,
    });

    if (error) {
      log.error('Failed to save push token:', error);
      return false;
    }

    log.debug('Push token saved to server');
    return true;
  } catch (error) {
    log.error('Error saving push token:', error);
    return false;
  }
}

export async function removePushTokenFromServer(
  token: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('push_tokens')
      .update({ is_active: false })
      .eq('token', token);

    if (error) {
      log.error('Failed to remove push token:', error);
      return false;
    }

    return true;
  } catch (error) {
    log.error('Error removing push token:', error);
    return false;
  }
}

export function handleNotificationResponse(
  response: NotificationResponse,
  navigate: (
    screen: string,
    params?: Record<string, string>
  ) => void | Promise<void>,
  requestUpdateCheck: (
    reason: 'push-notification'
  ) => void = requestMobileUpdateCheck
): void | Promise<void> {
  const data = response.notification.request.content.data as Record<
    string,
    unknown
  >;

  if (data.type === 'mobile_update_available') {
    requestUpdateCheck('push-notification');
    return;
  }

  const target = getStorefrontNotificationNavigationTarget(data);

  if (!target) return;

  return navigate(
    target.screen,
    'params' in target ? target.params : undefined
  );
}

export async function scheduleLocalNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>,
  triggerSeconds: number = 1
): Promise<string | null> {
  if (!Notifications) return null;
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: triggerSeconds,
    },
  });

  return id;
}

export async function cancelNotification(
  notificationId: string
): Promise<void> {
  if (!Notifications) return;
  await Notifications.cancelScheduledNotificationAsync(notificationId);
}

export async function cancelAllNotifications(): Promise<void> {
  if (!Notifications) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function getBadgeCount(): Promise<number> {
  if (!Notifications) return 0;
  return await Notifications.getBadgeCountAsync();
}

export async function setBadgeCount(count: number): Promise<void> {
  if (!Notifications) return;
  await Notifications.setBadgeCountAsync(count);
}

export async function clearBadge(): Promise<void> {
  if (!Notifications?.setBadgeCountAsync) return;
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch {
    // Silently fail on platforms that don't support badge count (e.g. web)
  }
}
