import type Expo from 'expo-server-sdk';
import type { ExpoPushMessage } from 'expo-server-sdk';
import { preparePushNotificationPayload } from '@/lib/prepare-push-notification-payload';
import {
  readNotificationType,
  recordPushAttemptWithStore,
} from './expo-push-attempts';
import {
  type DeliveryStartOptions,
  type PushChunkDelivery,
  sendPushNotificationChunks,
} from './expo-push-chunk-delivery';
import { excludeDeliveredTokens } from './expo-push-retry';
import { processTicketsWithStore } from './expo-push-tickets';
import type {
  MerchantNotificationOptions,
  NotificationChannel,
  NotificationSendResult,
  PushDelivery,
} from './expo-push-types';
import {
  createDeliveryStartBoundary,
  unknownDeliveryOutcome,
} from './push-delivery-boundary';

/**
 * Store-injected push delivery core. Everything here talks to the database
 * only through a `PushStore`, so a restricted worker can supply its own
 * store without this module ever importing a service-role client.
 */

/**
 * Send push notifications to multiple tokens through an Expo client.
 *
 * - Validates tokens with `Expo.isExpoPushToken()`
 * - Chunks messages to stay within Expo API limits
 * - Returns a ticket per original message (invalid tokens get synthetic error tickets)
 * - Reports `deliveryUncertain` when a provider request threw: the
 *   outcome is unknown, never inferred from ticket error codes
 */
export function sendPushNotificationsWith(
  expo: Expo,
  messages: ExpoPushMessage[],
  options?: DeliveryStartOptions
): Promise<PushChunkDelivery> {
  return sendPushNotificationChunks(expo, messages, {
    onDeliveryStart: options?.onDeliveryStart,
    onDeliveryRejected: options?.onDeliveryRejected,
  });
}

// ── Merchant / Customer delivery ─────────────────────────────────────────────

/**
 * Send notification to all active **admin** tokens for a merchant.
 */
export async function notifyMerchantWithStore(
  store: PushDelivery,
  merchantId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  channelId: NotificationChannel = 'general',
  options?: MerchantNotificationOptions
): Promise<NotificationSendResult> {
  if (options?.recipientUserIds?.length === 0) {
    return { sent: 0, failed: 0, errors: [] };
  }

  const { data: fetchedTokens, error } = await store.fetchMerchantTokens({
    merchantId,
    recipientUserIds: options?.recipientUserIds,
    requiredCapability: options?.requiredShipmentUpdateCapability,
  });

  if (error) {
    console.error('Error fetching push tokens:', error);
    const result = { sent: 0, failed: 0, errors: [error.message] };
    await recordPushAttemptWithStore(store, {
      merchantId,
      appType: 'admin',
      channel: channelId,
      notificationType: readNotificationType(data),
      title,
      body,
      payload: data,
      tokenCount: 0,
      result,
    });
    return result;
  }

  // Retries exclude tokens an earlier partial attempt already reached, so
  // delivered devices never get duplicates.
  const tokens = excludeDeliveredTokens(
    fetchedTokens ?? [],
    options?.excludeTokens
  );

  if (tokens.length === 0) {
    const result = { sent: 0, failed: 0, errors: [] };
    await recordPushAttemptWithStore(store, {
      merchantId,
      appType: 'admin',
      channel: channelId,
      notificationType: readNotificationType(data),
      title,
      body,
      payload: data,
      tokenCount: 0,
      result,
    });
    return result;
  }

  const messages: ExpoPushMessage[] = tokens.map((t) => ({
    to: t.token,
    title,
    body,
    data,
    sound: 'default' as const,
    channelId,
    priority: (channelId === 'orders' ? 'high' : 'default') as
      | 'high'
      | 'default',
  }));

  let result: NotificationSendResult;
  const deliveryBoundary = createDeliveryStartBoundary(
    options?.onDeliveryStart
  );
  try {
    const { deliveryUncertain, tickets } = await sendPushNotificationsWith(
      store.getExpo(),
      messages,
      {
        ...options,
        onDeliveryStart: deliveryBoundary.markDeliveryStarted,
      }
    );

    result = await processTicketsWithStore(tickets, tokens, store, {
      merchantId,
      appType: 'admin',
      channel: channelId,
      notificationType: readNotificationType(data),
      deliveryUncertain,
    });
  } catch (error) {
    result = {
      sent: 0,
      failed: tokens.length,
      ...unknownDeliveryOutcome(deliveryBoundary.wasDeliveryStarted()),
      errors: [
        error instanceof Error ? error.message : 'Unknown push send error',
      ],
    };
  }

  await recordPushAttemptWithStore(store, {
    merchantId,
    appType: 'admin',
    channel: channelId,
    notificationType: readNotificationType(data),
    title,
    body,
    payload: data,
    tokenCount: tokens.length,
    result,
  });
  return result;
}

/**
 * Send notification to all active **storefront** tokens for a customer.
 */
export async function notifyCustomerWithStore(
  store: PushDelivery,
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  channelId: NotificationChannel = 'orders',
  options?: { merchantId?: string } & DeliveryStartOptions
): Promise<NotificationSendResult> {
  const payload = preparePushNotificationPayload(data);

  // Merchant-specific notifications (e.g. wallet credits) must scope to the
  // tokens registered for that merchant's storefront — a user with tokens
  // from several merchant builds would otherwise get merchant A's push on
  // merchant B's app.
  const { data: tokens, error } = await store.fetchCustomerTokens({
    userId,
    merchantId: options?.merchantId,
    requiredCapability: options?.requiredShipmentUpdateCapability,
  });

  if (error) {
    console.error('Error fetching customer push tokens:', error);
    const result = { sent: 0, failed: 0, errors: [error.message] };
    await recordPushAttemptWithStore(store, {
      merchantId: options?.merchantId,
      userId,
      appType: 'storefront',
      channel: channelId,
      notificationType: readNotificationType(payload),
      title,
      body,
      payload,
      tokenCount: 0,
      result,
    });
    return result;
  }

  if (!tokens || tokens.length === 0) {
    const result = { sent: 0, failed: 0, errors: [] };
    await recordPushAttemptWithStore(store, {
      merchantId: options?.merchantId,
      userId,
      appType: 'storefront',
      channel: channelId,
      notificationType: readNotificationType(payload),
      title,
      body,
      payload,
      tokenCount: 0,
      result,
    });
    return result;
  }

  const messages: ExpoPushMessage[] = tokens.map((t) => ({
    to: t.token,
    title,
    body,
    data: payload,
    sound: 'default' as const,
    channelId,
    priority: (channelId === 'orders' ? 'high' : 'default') as
      | 'high'
      | 'default',
  }));

  let result: NotificationSendResult;
  try {
    const { deliveryUncertain, tickets } = await sendPushNotificationsWith(
      store.getExpo(),
      messages,
      {
        onDeliveryStart: options?.onDeliveryStart,
        onDeliveryRejected: options?.onDeliveryRejected,
      }
    );

    result = await processTicketsWithStore(tickets, tokens, store, {
      merchantId: options?.merchantId,
      userId,
      appType: 'storefront',
      channel: channelId,
      notificationType: readNotificationType(payload),
      deliveryUncertain,
    });
  } catch (error) {
    result = {
      sent: 0,
      failed: tokens.length,
      errors: [
        error instanceof Error ? error.message : 'Unknown push send error',
      ],
    };
  }

  await recordPushAttemptWithStore(store, {
    merchantId: options?.merchantId,
    userId,
    appType: 'storefront',
    channel: channelId,
    notificationType: readNotificationType(payload),
    title,
    body,
    payload,
    tokenCount: tokens.length,
    result,
  });
  return result;
}
