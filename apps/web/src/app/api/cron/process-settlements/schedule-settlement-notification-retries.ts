import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

// Rejections past this many attempts leave the bounded queue (the
// route query excludes them) for operations to dead-letter out of
// band, instead of pinning the daily run behind permanently failing
// rows. Mirrors the cancellation-notification retry cap.
export const SETTLEMENT_NOTIFICATION_MAX_ATTEMPTS = 5;

function notificationRetryDelayMs(attempts: number): number {
  return Math.min(2 ** (attempts - 1), 14) * 24 * 60 * 60 * 1000;
}

export interface SettlementNotificationRetryItem {
  id: string;
  notificationAttempts: number;
}

/**
 * Defer unnotified rows with backoff, grouped by next attempt count.
 * Past the cap the rows leave the bounded queue (the fetch excludes
 * them) and the dead-letter log is operations' backstop. Failures
 * only log: the row retries on the next run, and the caller already
 * counted the outcome.
 */
export async function scheduleSettlementNotificationRetries({
  items,
  logScope,
  reason,
  supabase,
}: {
  items: SettlementNotificationRetryItem[];
  logScope: { merchantId: string } | { merchantIds: string[] };
  reason: 'missing-email' | 'rejected';
  supabase: SupabaseClient;
}): Promise<void> {
  const retryGroups = new Map<number, string[]>();
  for (const item of items) {
    const attempts = item.notificationAttempts + 1;
    const ids = retryGroups.get(attempts) ?? [];
    ids.push(item.id);
    retryGroups.set(attempts, ids);
  }
  for (const [attempts, ids] of retryGroups) {
    const deadLettered = attempts >= SETTLEMENT_NOTIFICATION_MAX_ATTEMPTS;
    const { error: retryError } = await supabase
      .from('merchant_settlements')
      .update({
        notification_attempts: attempts,
        notification_next_retry_at: deadLettered
          ? null
          : new Date(
              Date.now() + notificationRetryDelayMs(attempts)
            ).toISOString(),
      })
      .eq('status', 'settled')
      .eq('settlement_notified', false)
      .in('id', ids);
    if (retryError) {
      logger.error({
        message: 'Failed to schedule settlement notification retry',
        ...logScope,
        error: retryError,
      });
    } else if (deadLettered) {
      logger.error({
        message:
          reason === 'rejected'
            ? 'Settlement notification dead-lettered after repeated rejections'
            : 'Settlement notification dead-lettered: merchant email missing',
        ...logScope,
        settlementIds: ids,
        attempts,
      });
    }
  }
}
