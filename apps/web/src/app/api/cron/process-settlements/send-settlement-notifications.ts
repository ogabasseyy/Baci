import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import type { sendEmail } from '@/lib/zeptomail';
import { scheduleSettlementNotificationRetries } from './schedule-settlement-notification-retries';
import {
  type MerchantSettlementBatch,
  sendMerchantSettlementBatch,
} from './send-merchant-settlement-batch';

interface PendingSettlementNotification {
  description: string | null;
  gateway: string;
  id: string;
  merchants: unknown;
  net_amount: number | string;
  notification_attempts: number | null;
}

/**
 * Send one batched notification email per merchant for newly settled
 * rows, then mark exactly the rows still settled-and-unnotified so a
 * concurrent reversal is never announced twice. Returns the send
 * counts for the route response.
 */
export async function sendSettlementNotifications({
  pendingNotifications,
  sendEmail: sendSettlementEmail,
  supabase,
}: {
  pendingNotifications: PendingSettlementNotification[] | null;
  sendEmail: typeof sendEmail;
  supabase: SupabaseClient;
}): Promise<{ failed: number; sent: number }> {
  const notificationResults = {
    sent: 0,
    failed: 0,
  };

  if (pendingNotifications && pendingNotifications.length > 0) {
    // Group settlements by merchant for batch notifications
    const merchantSettlements = new Map<string, MerchantSettlementBatch>();
    const missingEmail: Array<{
      id: string;
      merchantId: string;
      notificationAttempts: number;
    }> = [];

    for (const settlement of pendingNotifications) {
      const merchant = settlement.merchants as unknown as {
        id: string;
        business_name: string;
        email: string | null;
      };

      // No address to send to — but skipping silently would pin the
      // bounded queue at zero attempts, so these rows defer through
      // the same retry accounting below.
      if (!merchant?.email) {
        missingEmail.push({
          id: settlement.id,
          merchantId: merchant?.id ?? 'unknown',
          notificationAttempts: Number(settlement.notification_attempts ?? 0),
        });
        continue;
      }

      const key = merchant.id;
      const existing = merchantSettlements.get(key);

      if (existing) {
        existing.settlements.push({
          id: settlement.id,
          amount: Number(settlement.net_amount),
          gateway: settlement.gateway,
          description: settlement.description || 'Payment',
          notificationAttempts: Number(settlement.notification_attempts ?? 0),
        });
        existing.totalAmount += Number(settlement.net_amount);
      } else {
        merchantSettlements.set(key, {
          merchantId: merchant.id,
          businessName: merchant.business_name,
          email: merchant.email,
          settlements: [
            {
              id: settlement.id,
              amount: Number(settlement.net_amount),
              gateway: settlement.gateway,
              description: settlement.description || 'Payment',
              notificationAttempts: Number(
                settlement.notification_attempts ?? 0
              ),
            },
          ],
          totalAmount: Number(settlement.net_amount),
        });
      }
    }

    // Send one email per merchant
    for (const [, data] of merchantSettlements) {
      const batch = await sendMerchantSettlementBatch({
        batch: data,
        sendEmail: sendSettlementEmail,
        supabase,
      });
      notificationResults.sent += batch.sent;
      notificationResults.failed += batch.failed;
    }

    // Rows whose merchant has no email address cannot send, but must
    // still advance through retry accounting: left at zero attempts
    // they would pin the bounded queue exactly like unhandled
    // rejections. A late-added email notifies on a later run while
    // the row is still under the cap.
    if (missingEmail.length > 0) {
      const merchantIds = [
        ...new Set(missingEmail.map((row) => row.merchantId)),
      ];
      logger.error({
        message: 'Settlement notification skipped: merchant email missing',
        merchantIds,
        settlementIds: missingEmail.map((row) => row.id),
      });
      await scheduleSettlementNotificationRetries({
        items: missingEmail,
        logScope: { merchantIds },
        reason: 'missing-email',
        supabase,
      });
      notificationResults.failed += merchantIds.length;
    }
  }

  return notificationResults;
}
