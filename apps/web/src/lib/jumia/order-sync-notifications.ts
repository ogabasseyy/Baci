import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import type { JumiaOrder } from '@/schemas/jumia';
import type { ExistingJumiaOrderRow } from './order-sync-mappers';
import { JUMIA_NOTIFICATION_MARKER_RETRY_CODES } from './order-sync-notification-retry-codes';
import type {
  buildExistingJumiaCacheEntry,
  notifySyncedJumiaOrder,
} from './order-sync-operations';

const NOTIFICATION_SENT_UPDATE_ATTEMPTS = 3;
const NOTIFICATION_SENT_UPDATE_RETRY_DELAY_MS = 25;

interface SyncErrorLike {
  message: string;
  code?: string;
}

interface MarkNotificationOptions {
  attempts?: number;
  retryDelayMs?: number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableNotificationMarkerError(error: SyncErrorLike) {
  const code = error.code;
  if (!code) return true;

  return (
    JUMIA_NOTIFICATION_MARKER_RETRY_CODES.postgresPrefixes.some((prefix) =>
      code.startsWith(prefix)
    ) || JUMIA_NOTIFICATION_MARKER_RETRY_CODES.postgrestCodes.includes(code)
  );
}

export function getJumiaNotificationAttemptKey(
  merchantId: string,
  jumiaOrderId: string
) {
  return `${encodeURIComponent(merchantId)}:${encodeURIComponent(jumiaOrderId)}`;
}

/**
 * Reports whether a new-order push for this Jumia order was already
 * delivered, consulting the durable push-attempt log. When the provider
 * accepts a push but the notification marker write keeps failing, the
 * sync cursor parks with `notification_sent` false and the next run
 * would resend; this pre-dispatch check closes that resend hole.
 *
 * Fails open: a lookup failure returns false so first-time
 * notifications are never suppressed by a best-effort dedup query.
 */
export async function shouldSkipDeliveredJumiaNotification(
  supabase: SupabaseClient,
  merchantId: string,
  jumiaOrderId: string
): Promise<boolean> {
  // A previous run may have delivered the push while the marker write
  // failed; the durable attempt log suppresses the resend and the stale
  // marker is repaired best-effort so later runs skip via the cheap check.
  const alreadyDelivered = await hasSentJumiaOrderNotification(
    supabase,
    merchantId,
    jumiaOrderId
  );
  if (!alreadyDelivered) return false;
  await markJumiaNotificationSent(supabase, merchantId, jumiaOrderId);
  return true;
}

export async function hasSentJumiaOrderNotification(
  supabase: SupabaseClient,
  merchantId: string,
  jumiaOrderId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('push_notification_attempts')
      .select('id')
      .eq('merchant_id', merchantId)
      .eq('notification_type', 'new_order')
      .eq('payload->>jumia_order_id', jumiaOrderId)
      .in('status', ['sent', 'partial_failure']);
    if (error || !data) return false;
    return data.length > 0;
  } catch {
    return false;
  }
}

export interface SendJumiaOrderNotificationArgs {
  merchantId: string;
  integrationId: string;
  order: JumiaOrder;
  canonicalOrderId: string;
  notificationKey: string;
  attemptedNotificationKeys: Set<string>;
  existingJumiaOrders: Map<string, ExistingJumiaOrderRow>;
  notifySyncedJumiaOrder: typeof notifySyncedJumiaOrder;
  buildExistingJumiaCacheEntry: typeof buildExistingJumiaCacheEntry;
  onNotified: () => void;
}

/**
 * Sends the new-order push unless a previous run already delivered it,
 * then persists the notification marker. Reports delivery through
 * `onNotified` as soon as the provider accepts the push (even when a
 * later marker write fails). Throws when delivery or the marker write
 * fails so the sync cursor parks the order for retry.
 */
export async function sendJumiaOrderNotification(
  supabase: SupabaseClient,
  args: SendJumiaOrderNotificationArgs
): Promise<void> {
  if (
    await shouldSkipDeliveredJumiaNotification(
      supabase,
      args.merchantId,
      args.order.id
    )
  ) {
    return;
  }
  args.attemptedNotificationKeys.add(args.notificationKey);
  const rawNotificationResult = await args.notifySyncedJumiaOrder(
    args.merchantId,
    args.order,
    args.canonicalOrderId
  );
  if (!rawNotificationResult) {
    logger.warn({
      message: 'Jumia order notification returned no delivery result',
      merchantId: args.merchantId,
      integrationId: args.integrationId,
      jumiaOrderId: args.order.id,
      baciOrderId: args.canonicalOrderId,
    });
  }
  const notificationResult = rawNotificationResult ?? {
    sent: 0,
    failed: 0,
    errors: [],
  };
  if (notificationResult.sent > 0) {
    args.onNotified();
    // The push provider accepted the notification. Keep duplicated Jumia
    // pages in this run from rebuilding a stale cache row as unnotified.
    args.existingJumiaOrders.set(
      args.order.id,
      args.buildExistingJumiaCacheEntry(
        args.order.id,
        true,
        args.canonicalOrderId
      )
    );
    const notificationUpdateError = await markJumiaNotificationSent(
      supabase,
      args.merchantId,
      args.order.id
    );
    if (notificationUpdateError) {
      const markerErrorMessage = `Failed to mark Jumia notification as sent: ${notificationUpdateError.message}`;
      logger.error({
        message: 'Failed to mark Jumia order notification as sent',
        merchantId: args.merchantId,
        integrationId: args.integrationId,
        jumiaOrderId: args.order.id,
        error: notificationUpdateError,
      });
      throw new Error(markerErrorMessage);
    }
  }
  if (notificationResult.failed > 0 || notificationResult.errors.length > 0) {
    const failureDetails = [
      ...notificationResult.errors,
      notificationResult.failed > 0 &&
        `${notificationResult.failed} push notification(s) failed`,
    ].filter(Boolean);
    throw new Error(
      `Failed to notify merchant for Jumia order: ${failureDetails.join('; ')}`
    );
  }
}

export async function markJumiaNotificationSent(
  supabase: SupabaseClient,
  merchantId: string,
  jumiaOrderId: string,
  options: MarkNotificationOptions = {}
): Promise<SyncErrorLike | null> {
  const attempts = options.attempts ?? NOTIFICATION_SENT_UPDATE_ATTEMPTS;
  const retryDelayMs =
    options.retryDelayMs ?? NOTIFICATION_SENT_UPDATE_RETRY_DELAY_MS;
  let lastError: SyncErrorLike | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { data, error } = await supabase
      .from('jumia_orders')
      .update({ notification_sent: true })
      .eq('merchant_id', merchantId)
      .eq('jumia_order_id', jumiaOrderId)
      .select('jumia_order_id')
      .maybeSingle<{ jumia_order_id: string }>();
    if (!error) {
      if (data) return null;
      return {
        message: `No Jumia order notification marker updated for ${jumiaOrderId}`,
      };
    }
    lastError = error;

    if (!isRetryableNotificationMarkerError(error)) break;

    if (attempt < attempts && retryDelayMs > 0) {
      await sleep(retryDelayMs);
    }
  }

  return lastError;
}
