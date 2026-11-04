/**
 * Expo Push Notification Service
 * Sends push notifications via the official expo-server-sdk.
 *
 * The delivery core lives in `expo-push-core.ts` and talks to the database
 * through a `PushStore`; this module binds it to the service-role client for
 * every existing caller.
 *
 * @see https://docs.expo.dev/push-notifications/sending-notifications/
 */

import type { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { getExpoAccessToken } from '@/env';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  readNotificationType,
  recordPushAttemptWithStore,
} from './expo-push-attempts';
import type {
  DeliveryStartOptions,
  PushChunkDelivery,
} from './expo-push-chunk-delivery';
import {
  notifyCustomerWithStore,
  notifyMerchantWithStore,
  sendPushNotificationsWith,
} from './expo-push-core';
import { createLazyExpoGetter } from './expo-push-lazy-client';
import { activateProtectionMessage } from './expo-push-messages';
import { processTicketsWithStore } from './expo-push-tickets';
import type {
  MerchantNotificationOptions,
  NotificationChannel,
  NotificationSendResult,
  PushAttemptContext,
  PushDelivery,
  TicketContext,
} from './expo-push-types';
import { unknownDeliveryOutcome } from './push-delivery-boundary';
import { createAdminPushStore } from './push-store-admin';

export type { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
export type {
  NotificationChannel,
  NotificationSendResult,
  PushAttemptContext,
  TicketContext,
} from './expo-push-types';

// Module-scope cache: locale + minimumFractionDigits are static; currency varies.
const _currencyFormatterCache = new Map<string, Intl.NumberFormat>();
function _getCurrencyFormatter(currency: string): Intl.NumberFormat {
  let formatter = _currencyFormatterCache.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
    });
    _currencyFormatterCache.set(currency, formatter);
  }
  return formatter;
}

/**
 * Format amount as currency (e.g. ₦5,000)
 */
export function formatCurrency(amount: number, currency = 'NGN'): string {
  return _getCurrencyFormatter(currency).format(amount);
}

type AdminSupabase = ReturnType<typeof createAdminClient>;

const getExpo = createLazyExpoGetter(() => getExpoAccessToken());

function createAdminDelivery(supabase: AdminSupabase): PushDelivery {
  return { ...createAdminPushStore(supabase), getExpo };
}

/**
 * Send push notification to a single token.
 */
export async function sendPushNotification(
  token: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  channelId: NotificationChannel = 'general'
): Promise<ExpoPushTicket> {
  const messages: ExpoPushMessage[] = [
    {
      to: token,
      title,
      body,
      data,
      sound: 'default',
      channelId,
      priority: channelId === 'orders' ? 'high' : 'default',
    },
  ];

  const { tickets } = await sendPushNotifications(messages);
  return tickets[0];
}

/**
 * Send push notifications to multiple tokens.
 */
export function sendPushNotifications(
  messages: ExpoPushMessage[],
  options?: DeliveryStartOptions
): Promise<PushChunkDelivery> {
  return sendPushNotificationsWith(getExpo(), messages, options);
}

/**
 * Send notification to all active **admin** tokens for a merchant.
 */
export function notifyMerchant(
  merchantId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  channelId: NotificationChannel = 'general',
  options?: MerchantNotificationOptions
): Promise<NotificationSendResult> {
  return notifyMerchantWithStore(
    createAdminDelivery(createAdminClient()),
    merchantId,
    title,
    body,
    data,
    channelId,
    options
  );
}

/**
 * Send notification to all active **storefront** tokens for a customer.
 */
export function notifyCustomer(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  channelId: NotificationChannel = 'orders',
  options?: { merchantId?: string } & DeliveryStartOptions
): Promise<NotificationSendResult> {
  return notifyCustomerWithStore(
    createAdminDelivery(createAdminClient()),
    userId,
    title,
    body,
    data,
    channelId,
    options
  );
}

export function processTickets(
  tickets: Parameters<typeof processTicketsWithStore>[0],
  tokens: Parameters<typeof processTicketsWithStore>[1],
  supabase: AdminSupabase,
  context?: TicketContext
): Promise<NotificationSendResult> {
  return processTicketsWithStore(
    tickets,
    tokens,
    createAdminDelivery(supabase),
    context
  );
}

export function recordPushAttempt(
  supabase: AdminSupabase,
  context: PushAttemptContext
): Promise<void> {
  return recordPushAttemptWithStore(createAdminDelivery(supabase), context);
}

/**
 * Send notification only to the authenticated admin user's own registered devices.
 * Useful for safe test pushes without broadcasting to the whole merchant team.
 */
export async function notifyAdminUserDevices(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  channelId: NotificationChannel = 'admin'
): Promise<NotificationSendResult> {
  const supabase = createAdminClient();

  const { data: tokens, error } = await supabase
    .from('push_tokens')
    .select('token, platform')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('app_type', 'admin');

  if (error) {
    console.error('Error fetching admin user push tokens:', error);
    const result = { sent: 0, failed: 0, errors: [error.message] };
    await recordPushAttempt(supabase, {
      userId,
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

  if (!tokens || tokens.length === 0) {
    const result = { sent: 0, failed: 0, errors: [] };
    await recordPushAttempt(supabase, {
      userId,
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
    priority: 'default',
  }));

  let result: NotificationSendResult;
  try {
    const { deliveryUncertain, tickets } =
      await sendPushNotifications(messages);
    result = await processTickets(tickets, tokens, supabase, {
      userId,
      appType: 'admin',
      channel: channelId,
      notificationType: readNotificationType(data),
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

  await recordPushAttempt(supabase, {
    userId,
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

// =============================================================================
// MERCHANT NOTIFICATION EVENT HELPERS
// =============================================================================

/**
 * Notify merchant of a new order.
 */
export function notifyNewOrder(
  merchantId: string,
  orderId: string,
  orderNumber: string,
  customerName: string,
  amount: number,
  currency = 'NGN'
): Promise<NotificationSendResult> {
  const formattedAmount = formatCurrency(amount, currency);

  return notifyMerchant(
    merchantId,
    '🛒 New Order',
    `Order #${orderNumber} from ${customerName} - ${formattedAmount}`,
    {
      type: 'new_order',
      order_id: orderId,
      order_number: orderNumber,
      amount,
      currency,
    },
    'orders'
  );
}

/**
 * Notify merchant of payment received.
 */
export function notifyPaymentReceived(
  merchantId: string,
  amount: number,
  currency = 'NGN',
  orderNumber?: string,
  orderId?: string
): Promise<NotificationSendResult> {
  const formattedAmount = formatCurrency(amount, currency);

  const body = orderNumber
    ? `Payment of ${formattedAmount} received for order #${orderNumber}`
    : `Payment of ${formattedAmount} received`;

  return notifyMerchant(
    merchantId,
    '💰 Payment Received',
    body,
    {
      type: 'payment_received',
      amount,
      currency,
      order_id: orderId,
      order_number: orderNumber,
    },
    'payments'
  );
}

/**
 * Notify merchant of low stock.
 */
export async function notifyLowStock(
  merchantId: string,
  productId: string | null,
  productName: string,
  currentStock: number,
  threshold: number
): Promise<void> {
  await notifyMerchant(
    merchantId,
    '⚠️ Low Stock Alert',
    `${productName} is low on stock (${currentStock} remaining, threshold: ${threshold})`,
    {
      type: 'low_stock',
      product_id: productId,
      product_name: productName,
      current_stock: currentStock,
      threshold,
    },
    'stock'
  );
}

/**
 * Notify merchant of a new review.
 */
export async function notifyNewReview(
  merchantId: string,
  productName: string,
  rating: number,
  reviewerName: string
): Promise<void> {
  const stars = '⭐'.repeat(rating);

  await notifyMerchant(
    merchantId,
    '📝 New Review',
    `${reviewerName} left a ${rating}-star review on ${productName} ${stars}`,
    {
      type: 'new_review',
      product_name: productName,
      rating,
      reviewer_name: reviewerName,
    },
    'general'
  );
}

/**
 * Notify merchant of withdrawal processed.
 */
export async function notifyWithdrawalProcessed(
  merchantId: string,
  amount: number,
  currency = 'NGN',
  bankName?: string
): Promise<void> {
  const formattedAmount = formatCurrency(amount, currency);

  const body = bankName
    ? `${formattedAmount} has been sent to your ${bankName} account`
    : `${formattedAmount} withdrawal has been processed`;

  await notifyMerchant(
    merchantId,
    '🏦 Withdrawal Processed',
    body,
    {
      type: 'withdrawal_processed',
      amount,
      currency,
      bank_name: bankName,
    },
    'payments'
  );
}

/**
 * Notify merchant of a new Jumia order.
 */
export async function notifyJumiaOrder(
  merchantId: string,
  jumiaOrderNumber: string,
  customerName: string,
  amount: number,
  currency = 'NGN'
): Promise<void> {
  const formattedAmount = formatCurrency(amount, currency);

  await notifyMerchant(
    merchantId,
    '🟠 Jumia Order',
    `Order #${jumiaOrderNumber} from ${customerName} - ${formattedAmount}`,
    {
      type: 'jumia_order',
      jumia_order_number: jumiaOrderNumber,
      amount,
      currency,
    },
    'orders'
  );
}

// =============================================================================
// CUSTOMER NOTIFICATION EVENT HELPERS (for storefront mobile apps)
// =============================================================================

/**
 * Notify customer of order status change.
 */
export async function notifyOrderStatusChange(
  userId: string,
  orderId: string,
  orderNumber: string,
  status: string,
  message?: string
): Promise<void> {
  const statusTitles: Record<string, string> = {
    confirmed: '✅ Order Confirmed!',
    processing: '📦 Order Being Prepared',
    shipped: '🚚 Order Shipped!',
    out_for_delivery: '🛵 Out for Delivery!',
    delivered: '🎉 Order Delivered!',
    cancelled: '❌ Order Cancelled',
    refunded: '💰 Refund Processed',
  };

  const statusMessages: Record<string, string> = {
    confirmed: `Your order #${orderNumber} has been confirmed and is being processed.`,
    processing: `Your order #${orderNumber} is being prepared for shipping.`,
    shipped: `Great news! Your order #${orderNumber} has been shipped.`,
    out_for_delivery: `Your order #${orderNumber} is out for delivery. Get ready!`,
    delivered: `Your order #${orderNumber} has been delivered. Enjoy!`,
    cancelled: `Your order #${orderNumber} has been cancelled.`,
    refunded: `A refund has been processed for order #${orderNumber}.`,
  };

  const title = statusTitles[status] || `Order Update: #${orderNumber}`;
  const body =
    message ||
    statusMessages[status] ||
    `Your order #${orderNumber} status has been updated to ${status}.`;

  await notifyCustomer(
    userId,
    title,
    body,
    {
      type: 'order_update',
      orderId,
      orderNumber,
      status,
    },
    'orders'
  );
}

/**
 * Prompt a customer to activate their gadget insurance after delivery.
 *
 * Gadget cover requires a post-purchase pre-loss inspection (device photos) to
 * activate, and that can only happen once the device is delivered. This is the
 * delivery-triggered nudge to complete it.
 */
export function notifyActivateProtection(
  userId: string,
  orderId: string,
  orderNumber: string,
  options?: { merchantId?: string }
): Promise<NotificationSendResult> {
  const message = activateProtectionMessage(orderId, orderNumber);
  return notifyCustomer(
    userId,
    message.title,
    message.body,
    message.data,
    'orders',
    options
  );
}

/**
 * Notify customer of promotional offer.
 */
export async function notifyCustomerPromotion(
  userId: string,
  title: string,
  body: string,
  productSlug?: string,
  categorySlug?: string
): Promise<void> {
  await notifyCustomer(
    userId,
    title,
    body,
    {
      type: 'promotion',
      productSlug,
      categorySlug,
    },
    'promotions'
  );
}

/**
 * Notify customer that a product is back in stock.
 */
export async function notifyBackInStock(
  userId: string,
  productName: string,
  productSlug: string
): Promise<void> {
  await notifyCustomer(
    userId,
    '🔔 Back in Stock!',
    `${productName} is now available. Get it before it's gone!`,
    {
      type: 'back_in_stock',
      productSlug,
    },
    'promotions'
  );
}

/**
 * Notify customer of price drop on a wishlisted item.
 */
export async function notifyPriceDrop(
  userId: string,
  productName: string,
  productSlug: string,
  oldPrice: number,
  newPrice: number,
  currency = 'NGN'
): Promise<void> {
  const discount =
    oldPrice > 0 ? Math.round(((oldPrice - newPrice) / oldPrice) * 100) : 0;

  await notifyCustomer(
    userId,
    `💸 Price Drop: ${discount}% Off!`,
    `${productName} is now ${formatCurrency(newPrice, currency)} (was ${formatCurrency(oldPrice, currency)})`,
    {
      type: 'price_drop',
      productSlug,
      oldPrice,
      newPrice,
      discount,
    },
    'promotions'
  );
}

export { notifyNewInvoice } from './invoice-notifications';
export type {
  StorefrontUpdateNudgeParams,
  StorefrontUpdateNudgeResult,
} from './mobile-update-nudge';
