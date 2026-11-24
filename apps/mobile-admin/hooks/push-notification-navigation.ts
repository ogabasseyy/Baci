import type { NotificationResponse } from 'expo-notifications';
import type { Href } from 'expo-router';
import { requestMobileUpdateCheck } from '@/components/updates/mobile-update-events';
import {
  handleChatReplyResponse,
  isChatReplyResponse,
} from '@/services/chat-notification-reply';
import { getNotificationNavigationParams } from '@/services/push-notifications';

interface AdminRouter {
  push: (href: Href) => void;
}

function encodeAdminEntityId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const trimmedValue = String(value).trim();
  if (!trimmedValue) {
    return null;
  }

  return encodeURIComponent(trimmedValue);
}

export function navigateToNotificationTarget(
  router: AdminRouter,
  navParams: ReturnType<typeof getNotificationNavigationParams>
) {
  if (!navParams) {
    return;
  }

  const entityId = encodeAdminEntityId(navParams.params?.id);

  switch (navParams.screen) {
    case 'order':
      router.push(
        entityId
          ? (`/(admin)/order/${entityId}` as Href)
          : '/(admin)/(tabs)/orders'
      );
      return;
    case 'product':
      router.push(
        entityId
          ? (`/(admin)/product/${entityId}` as Href)
          : '/(admin)/(tabs)/products'
      );
      return;
    case 'orders':
      router.push('/(admin)/(tabs)/orders');
      return;
    case 'products':
      router.push('/(admin)/(tabs)/products');
      return;
    case 'notifications':
      router.push('/(admin)/notifications');
      return;
    case 'negotiations':
      router.push('/(admin)/negotiations');
      return;
    case 'negotiation':
      // No negotiation detail route exists — only the list screen
      // (`/(admin)/negotiations`), which shows the newest request first with
      // inline Accept/Reject. Routing to a `negotiations/[id]` path that has no
      // matching file throws Expo Router's "Unmatched Route" error, so always
      // land on the list. entityId is intentionally unused here.
      router.push('/(admin)/negotiations');
      return;
    case 'repair':
      router.push(
        entityId ? (`/(admin)/repairs/${entityId}` as Href) : '/(admin)/repairs'
      );
      return;
    case 'repairs':
      router.push('/(admin)/repairs');
      return;
    case 'message':
      router.push(
        entityId
          ? (`/(admin)/messages/${entityId}` as Href)
          : ('/(admin)/messages' as Href)
      );
      return;
    case 'messages':
      router.push('/(admin)/messages' as Href);
      return;
    default:
      router.push('/(admin)/(tabs)');
  }
}

function isPlainNotificationData(
  value: unknown
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Handle a tapped notification: trigger an in-app update check for
 * `mobile_update_available` nudges (without navigating), otherwise route to the
 * notification's navigation target.
 */
export function handleNotificationTap(
  router: AdminRouter,
  response: NotificationResponse,
  requestUpdateCheck: (
    reason: 'push-notification'
  ) => void = requestMobileUpdateCheck
) {
  const data = response.notification.request.content.data;
  if (!isPlainNotificationData(data)) {
    return;
  }

  // The Reply box on a chat notification: send the text, do not just open it.
  if (isChatReplyResponse(response)) {
    void handleChatReplyResponse(router, response);
    return;
  }

  if (data.type === 'mobile_update_available') {
    requestUpdateCheck('push-notification');
    return;
  }

  navigateToNotificationTarget(
    router,
    getNotificationNavigationParams(response)
  );
}
