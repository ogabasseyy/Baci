/**
 * Expo Push Notification Service
 * Sends push notifications via the official expo-server-sdk.
 *
 * @see https://docs.expo.dev/push-notifications/sending-notifications/
 */

import Expo, {
  type ExpoPushMessage,
  type ExpoPushTicket,
} from 'expo-server-sdk';
import { getExpoAccessToken } from '@/env';
import { chunkArray, SUPABASE_IN_FILTER_CHUNK_SIZE } from '@/lib/chunk-array';
import { preparePushNotificationPayload } from '@/lib/prepare-push-notification-payload';
import { filterPushTokensByShipmentUpdateCapability } from '@/lib/push-token-capability';
import {
  getPushTokenDeactivationReason,
  shouldDeactivateForInvalidCredentials,
} from '@/lib/push-token-errors';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  type DeliveryStartOptions,
  sendPushNotificationChunks,
} from './expo-push-chunk-delivery';
import { excludeDeliveredTokens, withDeliveredTokens } from './expo-push-retry';

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

// ── Lazy-initialized Expo client (avoids module-level constructor for testability) ──

let _expo: Expo | null = null;
function _getExpo(): Expo {
  if (!_expo) {
    const accessToken = getExpoAccessToken();
    if (!accessToken) {
      console.warn(
        '[expo-push] EXPO_ACCESS_TOKEN is not set — push notifications may fail or be rate-limited'
      );
    }
    _expo = new Expo({ accessToken });
  }
  return _expo;
}

// ── Public types ─────────────────────────────────────────────────────────────

export type { ExpoPushMessage, ExpoPushTicket };
export interface NotificationSendResult {
  sent: number;
  failed: number;
  errors: string[];
  /** Tokens whose ticket was accepted, for retrying only the failed subset. */
  succeededTokens?: string[];
}

/**
 * Notification channel types for Android
 */
export type NotificationChannel =
  | 'orders'
  | 'payments'
  | 'stock'
  | 'general'
  | 'admin'
  | 'promotions';

type MerchantNotificationOptions = DeliveryStartOptions & {
  /** Skip these tokens (already delivered on an earlier partial attempt). */
  excludeTokens?: string[];
};

// ── Core send functions ──────────────────────────────────────────────────────

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

  const tickets = await sendPushNotifications(messages);
  return tickets[0];
}

/**
 * Send push notifications to multiple tokens.
 *
 * - Validates tokens with `Expo.isExpoPushToken()`
 * - Chunks messages to stay within Expo API limits
 * - Returns a ticket per original message (invalid tokens get synthetic error tickets)
 */
export function sendPushNotifications(
  messages: ExpoPushMessage[],
  options?: DeliveryStartOptions
): Promise<ExpoPushTicket[]> {
  return sendPushNotificationChunks(_getExpo(), messages, {
    onDeliveryStart: options?.onDeliveryStart,
    onDeliveryRejected: options?.onDeliveryRejected,
  });
}

// ── Merchant / Customer delivery ─────────────────────────────────────────────

/**
 * Send notification to all active **admin** tokens for a merchant.
 */
export async function notifyMerchant(
  merchantId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  channelId: NotificationChannel = 'general',
  options?: MerchantNotificationOptions
): Promise<NotificationSendResult> {
  const supabase = createAdminClient();

  const tokenQuery = filterPushTokensByShipmentUpdateCapability(
    supabase
      .from('push_tokens')
      .select('token, platform')
      .eq('merchant_id', merchantId)
      .eq('is_active', true)
      .eq('app_type', 'admin'),
    options?.requiredShipmentUpdateCapability
  );
  const { data: fetchedTokens, error } = await tokenQuery;

  if (error) {
    console.error('Error fetching push tokens:', error);
    const result = { sent: 0, failed: 0, errors: [error.message] };
    await recordPushAttempt(supabase, {
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
    await recordPushAttempt(supabase, {
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
  try {
    const tickets = await sendPushNotifications(messages, options);

    result = await processTickets(tickets, tokens, supabase, {
      merchantId,
      appType: 'admin',
      channel: channelId,
      notificationType: readNotificationType(data),
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
export async function notifyCustomer(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  channelId: NotificationChannel = 'orders',
  options?: { merchantId?: string } & DeliveryStartOptions
): Promise<NotificationSendResult> {
  const supabase = createAdminClient();
  const payload = preparePushNotificationPayload(data);

  // Merchant-specific notifications (e.g. wallet credits) must scope to the
  // tokens registered for that merchant's storefront — a user with tokens
  // from several merchant builds would otherwise get merchant A's push on
  // merchant B's app.
  let tokenQuery = supabase
    .from('push_tokens')
    .select('token, platform')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('app_type', 'storefront');
  if (options?.merchantId) {
    tokenQuery = tokenQuery.eq('merchant_id', options.merchantId);
  }
  tokenQuery = filterPushTokensByShipmentUpdateCapability(
    tokenQuery,
    options?.requiredShipmentUpdateCapability
  );
  const { data: tokens, error } = await tokenQuery;

  if (error) {
    console.error('Error fetching customer push tokens:', error);
    const result = { sent: 0, failed: 0, errors: [error.message] };
    await recordPushAttempt(supabase, {
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
    await recordPushAttempt(supabase, {
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
    const tickets = await sendPushNotifications(messages, {
      onDeliveryStart: options?.onDeliveryStart,
      onDeliveryRejected: options?.onDeliveryRejected,
    });

    result = await processTickets(tickets, tokens, supabase, {
      merchantId: options?.merchantId,
      userId,
      appType: 'storefront',
      channel: channelId,
      notificationType: readNotificationType(payload),
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
    const tickets = await sendPushNotifications(messages);
    result = await processTickets(tickets, tokens, supabase, {
      userId,
      appType: 'admin',
      channel: channelId,
      notificationType: readNotificationType(data),
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

// ── Shared ticket processing ─────────────────────────────────────────────────

export interface TicketContext {
  merchantId?: string;
  userId?: string;
  appType?: 'admin' | 'storefront';
  channel?: string;
  notificationType?: string;
}

/**
 * Platform-scoped isolation check for InvalidCredentials pruning. Returns
 * only the failing tokens whose platform group passes
 * `shouldDeactivateForInvalidCredentials` — a failure that spans (or
 * dominates) its platform's tokens indicates broken credentials for that
 * platform, not dead tokens.
 */
function selectPrunableInvalidCredentialsTokens(
  failingTokens: string[],
  batchTokens: { token: string; platform?: string | null }[]
): string[] {
  const platformByToken = new Map(
    batchTokens.map((entry) => [entry.token, entry.platform ?? 'unknown'])
  );
  const batchCountByPlatform = new Map<string, number>();
  for (const entry of batchTokens) {
    const platform = entry.platform ?? 'unknown';
    batchCountByPlatform.set(
      platform,
      (batchCountByPlatform.get(platform) ?? 0) + 1
    );
  }

  const failuresByPlatform = new Map<string, string[]>();
  for (const token of failingTokens) {
    const platform = platformByToken.get(token) ?? 'unknown';
    const failures = failuresByPlatform.get(platform) ?? [];
    failures.push(token);
    failuresByPlatform.set(platform, failures);
  }

  const prunable: string[] = [];
  for (const [platform, failures] of failuresByPlatform) {
    if (
      shouldDeactivateForInvalidCredentials(
        failures.length,
        batchCountByPlatform.get(platform) ?? 0
      )
    ) {
      prunable.push(...failures);
    }
  }
  return prunable;
}

export async function processTickets(
  tickets: ExpoPushTicket[],
  tokens: { token: string; platform?: string | null }[],
  supabase: ReturnType<typeof createAdminClient>,
  context?: TicketContext
): Promise<NotificationSendResult> {
  let sent = 0;
  let failed = 0;
  const succeededTokens: string[] = [];
  // Aggregate failures by error code so a 200-token send with one broken
  // token logs one actionable line instead of raw per-ticket noise.
  const errorAggregates = new Map<
    string,
    { count: number; sampleMessage: string }
  >();
  const tokensToDeactivate = new Map<string, string[]>();
  const ticketsToStore: Array<{
    ticket_id: string;
    push_token: string;
    merchant_id: string | null;
    user_id: string | null;
    app_type: string;
    channel: string | null;
    notification_type: string | null;
    status: 'pending';
  }> = [];

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    if (ticket.status === 'ok') {
      sent++;
      succeededTokens.push(tokens[i].token);
      // Store ok tickets for receipt polling (they have a ticket.id)
      ticketsToStore.push({
        ticket_id: ticket.id,
        push_token: tokens[i].token,
        merchant_id: context?.merchantId ?? null,
        user_id: context?.userId ?? null,
        app_type: context?.appType ?? 'admin',
        channel: context?.channel ?? null,
        notification_type: context?.notificationType ?? null,
        status: 'pending',
      });
    } else {
      failed++;
      const errorCode =
        typeof ticket.details?.error === 'string'
          ? ticket.details.error
          : 'UnknownError';
      const aggregate = errorAggregates.get(errorCode);
      if (aggregate) {
        aggregate.count++;
      } else {
        errorAggregates.set(errorCode, {
          count: 1,
          sampleMessage: ticket.message ?? 'No error message provided',
        });
      }
      const deactivationReason = getPushTokenDeactivationReason(errorCode);
      if (deactivationReason) {
        const tokenList = tokensToDeactivate.get(deactivationReason) ?? [];
        tokenList.push(tokens[i].token);
        tokensToDeactivate.set(deactivationReason, tokenList);
      }
    }
  }

  // Widespread InvalidCredentials means broken project credentials, not dead
  // tokens — leave those active (report-only) so pushes resume the moment
  // credentials are fixed. Credentials are scoped per platform (APNs vs FCM)
  // within a batch (each send targets a single app), so isolation is judged
  // against tokens of the SAME platform only: 5 failing iOS tokens in a
  // 100-token mostly-Android batch is still 100% of the iOS credential scope.
  const invalidCredentialsTokens = tokensToDeactivate.get('InvalidCredentials');
  if (invalidCredentialsTokens) {
    const prunable = selectPrunableInvalidCredentialsTokens(
      invalidCredentialsTokens,
      tokens
    );
    if (prunable.length > 0) {
      tokensToDeactivate.set('InvalidCredentials', prunable);
    } else {
      tokensToDeactivate.delete('InvalidCredentials');
    }
    const skipped = invalidCredentialsTokens.length - prunable.length;
    if (skipped > 0) {
      console.warn(
        `[expo-push] InvalidCredentials on ${skipped} token(s) looks like platform-wide credential breakage — tokens left active`
      );
    }
  }

  // Chunk the id list: .in() values ride in the request URL, so a large batch
  // (the update-nudge can surface thousands of dead tokens) would 414.
  const deactivatedCounts = new Map<string, number>();
  for (const [reason, tokenList] of tokensToDeactivate) {
    for (const tokenChunk of chunkArray(
      tokenList,
      SUPABASE_IN_FILTER_CHUNK_SIZE
    )) {
      const { error: deactivateError } = await supabase
        .from('push_tokens')
        .update({
          is_active: false,
          deactivation_reason: reason,
          deactivated_at: new Date().toISOString(),
        })
        .in('token', tokenChunk);
      if (deactivateError) {
        console.error(
          'Failed to deactivate undeliverable push tokens:',
          deactivateError
        );
      } else {
        deactivatedCounts.set(
          reason,
          (deactivatedCounts.get(reason) ?? 0) + tokenChunk.length
        );
      }
    }
  }

  const errors: string[] = [];
  for (const [code, aggregate] of errorAggregates) {
    const deactivatedCount = deactivatedCounts.get(code) ?? 0;
    const deactivationNote =
      deactivatedCount > 0 ? `, ${deactivatedCount} token(s) deactivated` : '';
    errors.push(
      `${code} (${aggregate.count} failed${deactivationNote}): ${aggregate.sampleMessage}`
    );
  }

  // Store successful tickets for receipt polling
  if (ticketsToStore.length > 0) {
    const { error: insertError } = await supabase
      .from('push_notification_tickets')
      .insert(ticketsToStore);
    if (insertError) {
      console.error('Failed to store push tickets:', insertError);
      errors.push(`Ticket storage failed: ${insertError.message}`);
    }
  }

  // Omit the key when empty so fully-failed batches keep the historical
  // result shape (the field is optional).
  return {
    sent,
    failed,
    errors,
    ...(succeededTokens.length > 0 ? { succeededTokens } : {}),
  };
}

export interface PushAttemptContext extends TicketContext {
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  tokenCount: number;
  result: NotificationSendResult;
}

function readNotificationType(
  data?: Record<string, unknown>
): string | undefined {
  return typeof data?.type === 'string' ? data.type : undefined;
}

function derivePushAttemptStatus(
  tokenCount: number,
  result: NotificationSendResult
): 'sent' | 'partial_failure' | 'failed' | 'skipped_no_tokens' {
  if (tokenCount === 0) {
    return 'skipped_no_tokens';
  }

  if (result.sent > 0 && result.failed === 0 && result.errors.length === 0) {
    return 'sent';
  }

  if (result.sent > 0) {
    return 'partial_failure';
  }

  return 'failed';
}

const PUSH_ATTEMPT_INSERT_ATTEMPTS = 3;
const PUSH_ATTEMPT_INSERT_RETRY_DELAY_MS = 100;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function recordPushAttempt(
  supabase: ReturnType<typeof createAdminClient>,
  context: PushAttemptContext
): Promise<void> {
  const notificationType =
    context.notificationType ??
    (typeof context.payload?.type === 'string' ? context.payload.type : null);

  // Persist per-token delivery state: retries read the union of delivered
  // tokens across partial attempts and resend only to the failed subset.
  const deliveredTokens = context.result.succeededTokens ?? [];
  const attemptRow = {
    merchant_id: context.merchantId ?? null,
    user_id: context.userId ?? null,
    app_type: context.appType ?? 'admin',
    channel: context.channel ?? null,
    notification_type: notificationType,
    title: context.title,
    body: context.body,
    payload: withDeliveredTokens(context.payload, deliveredTokens),
    token_count: context.tokenCount,
    sent_count: context.result.sent,
    failed_count: context.result.failed,
    status: derivePushAttemptStatus(context.tokenCount, context.result),
    errors: context.result.errors,
  };

  // A lost attempt row blinds the next retry's exclusion set and duplicates
  // alerts on delivered devices, so transient write failures are retried.
  for (let attempt = 1; ; attempt++) {
    const { error } = await supabase
      .from('push_notification_attempts')
      .insert(attemptRow);
    if (!error) {
      return;
    }
    if (attempt >= PUSH_ATTEMPT_INSERT_ATTEMPTS) {
      // Last resort: log loudly with enough context for manual
      // reconciliation. The delivery result is intentionally NOT failed
      // here — failing a delivered batch would park it for retry with an
      // empty exclusion set and duplicate alerts on every device, which is
      // worse than a missing log row.
      console.error('Failed to store push attempt:', error, {
        merchantId: context.merchantId ?? null,
        notificationType,
        tokenCount: context.tokenCount,
        deliveredTokenCount: deliveredTokens.length,
      });
      return;
    }
    await sleep(PUSH_ATTEMPT_INSERT_RETRY_DELAY_MS * attempt);
  }
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
  return notifyCustomer(
    userId,
    '🛡️ Activate your protection',
    `Your order #${orderNumber} was delivered. Complete a quick device inspection to activate your insurance cover.`,
    {
      type: 'insurance_activation',
      orderId,
      orderNumber,
    },
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
