import type { SupabaseClient } from '@supabase/supabase-js';
import { buildSettlementNotificationEmail } from '@/lib/build-settlement-notification-email';
import { logger } from '@/lib/logger';
import type { sendEmail } from '@/lib/zeptomail';
import { scheduleSettlementNotificationRetries } from './schedule-settlement-notification-retries';

interface PendingSettlementNotification {
  description: string | null;
  gateway: string;
  id: string;
  merchants: unknown;
  net_amount: number | string;
  notification_attempts: number | null;
}

interface MerchantSettlementBatch {
  businessName: string;
  email: string;
  merchantId: string;
  settlements: Array<{
    amount: number;
    description: string;
    gateway: string;
    id: string;
    notificationAttempts: number;
  }>;
  totalAmount: number;
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
      // Hoisted for the catch: a throw during revalidation, email
      // preparation, or delivery must still advance these rows
      // through retry accounting, or they pin the bounded
      // oldest-first batch on every invocation.
      let stillSettled: MerchantSettlementBatch['settlements'] = [];
      try {
        const settlementIds = data.settlements.map((s) => s.id);

        // Revalidate immediately before sending: a concurrent refund
        // may have reversed (cancelled) a snapshotted settlement
        // after the batch read. Only settled, still-unnotified rows
        // are announced. A reversal landing between this read and the
        // send can still announce once; the guarded mark below keeps
        // the flag truthful so it never repeats.
        const { data: fresh, error: freshError } = await supabase
          .from('merchant_settlements')
          .select('id, status, settlement_notified')
          .in('id', settlementIds);
        if (freshError) throw freshError;
        const current = new Map(
          (
            (fresh ?? []) as Array<{
              id: string;
              settlement_notified: boolean;
              status: string;
            }>
          ).map((row) => [row.id, row])
        );
        stillSettled = data.settlements.filter((item) => {
          const row = current.get(item.id);
          return row?.status === 'settled' && row.settlement_notified === false;
        });
        if (stillSettled.length === 0) continue;
        const totalAmount = stillSettled.reduce(
          (sum, item) => sum + item.amount,
          0
        );

        // ZeptoMail resolves failures instead of throwing. A
        // definite rejection (invalid recipient, exhausted provider
        // retries) stays unnotified and retryable. An uncertain
        // outcome (timeout after the provider may have accepted) must
        // NOT rejoin the retry queue — the next run could duplicate a
        // delivered message — so it marks notified below but still
        // counts failed so operations verifies actual delivery.
        const emailResult = await sendSettlementEmail(
          buildSettlementNotificationEmail({
            ...data,
            settlements: stillSettled,
            totalAmount,
          })
        );
        const uncertainDelivery =
          !emailResult.success && emailResult.deliveryOutcome === 'unknown';
        if (!emailResult.success && !uncertainDelivery) {
          logger.error({
            message: 'Settlement notification email rejected',
            merchantId: data.merchantId,
            error: emailResult,
          });
          // A definite rejection stays unnotified but must not rejoin
          // the head of the bounded oldest-first queue immediately.
          await scheduleSettlementNotificationRetries({
            items: stillSettled,
            logScope: { merchantId: data.merchantId },
            reason: 'rejected',
            supabase,
          });
          notificationResults.failed++;
          continue;
        }

        // Guard the mark with the same predicates: a reversal racing
        // the send must not be flagged notified. Supabase resolves
        // write failures instead of throwing, so check the response:
        // reporting sent when the mark failed would hide the next
        // run's duplicate email behind a success signal.
        const { error: markError } = await supabase
          .from('merchant_settlements')
          .update({
            settlement_notified: true,
            notification_sent_at: new Date().toISOString(),
          })
          .eq('status', 'settled')
          .eq('settlement_notified', false)
          .in(
            'id',
            stillSettled.map((s) => s.id)
          );

        if (markError) {
          logger.error({
            message: 'Failed to mark settlement notification sent',
            merchantId: data.merchantId,
            error: markError,
          });
          // The email was delivered but the mark failed: the rows
          // stay settled-yet-unnotified at the head of the bounded
          // oldest-first batch, so they advance through the same
          // retry accounting as thrown errors instead of pinning
          // every later merchant behind them.
          await scheduleSettlementNotificationRetries({
            items: stillSettled,
            logScope: { merchantId: data.merchantId },
            reason: 'error',
            supabase,
          });
          notificationResults.failed++;
          continue;
        }

        if (uncertainDelivery) {
          // Persisted as notified so no retry duplicates a possibly
          // delivered message; failed so the run signals operations
          // to verify delivery out of band.
          logger.error({
            message: 'Settlement notification delivery uncertain',
            merchantId: data.merchantId,
            error: emailResult,
          });
          notificationResults.failed++;
          continue;
        }

        notificationResults.sent++;
      } catch (emailError) {
        logger.error({
          message: 'Failed to send settlement notification',
          merchantId: data.merchantId,
          error: emailError,
        });
        // Thrown errors are pre-dispatch (revalidation read, email
        // build, sender-domain resolution): ZeptoMail resolves
        // post-dispatch outcomes instead of throwing, and the
        // notified mark above resolves its errors for explicit
        // checking — so nothing thrown here was announced, and the
        // rows rejoin the retry queue rather than pinning the
        // batch. A throw before revalidation completed falls back
        // to the whole merchant batch; the scheduler's guarded
        // update skips rows that reversed since the batch read.
        const retryItems =
          stillSettled.length > 0 ? stillSettled : data.settlements;
        await scheduleSettlementNotificationRetries({
          items: retryItems,
          logScope: { merchantId: data.merchantId },
          reason: 'error',
          supabase,
        });
        notificationResults.failed++;
      }
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
