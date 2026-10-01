import type { SupabaseClient } from '@supabase/supabase-js';
import { buildSettlementNotificationEmail } from '@/lib/build-settlement-notification-email';
import { logger } from '@/lib/logger';
import type { sendEmail } from '@/lib/zeptomail';

interface PendingSettlementNotification {
  description: string | null;
  gateway: string;
  id: string;
  merchants: unknown;
  net_amount: number | string;
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

    for (const settlement of pendingNotifications) {
      const merchant = settlement.merchants as unknown as {
        id: string;
        business_name: string;
        email: string | null;
      };

      if (!merchant?.email) continue;

      const key = merchant.id;
      const existing = merchantSettlements.get(key);

      if (existing) {
        existing.settlements.push({
          id: settlement.id,
          amount: Number(settlement.net_amount),
          gateway: settlement.gateway,
          description: settlement.description || 'Payment',
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
            },
          ],
          totalAmount: Number(settlement.net_amount),
        });
      }
    }

    // Send one email per merchant
    for (const [, data] of merchantSettlements) {
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
        const stillSettled = data.settlements.filter((item) => {
          const row = current.get(item.id);
          return row?.status === 'settled' && row.settlement_notified === false;
        });
        if (stillSettled.length === 0) continue;
        const totalAmount = stillSettled.reduce(
          (sum, item) => sum + item.amount,
          0
        );

        // ZeptoMail resolves definitive rejections (invalid
        // recipient, exhausted provider retries) instead of throwing:
        // only mark notified when the send actually succeeded, so a
        // failed email stays retryable instead of vanishing behind a
        // success signal.
        const emailResult = await sendSettlementEmail(
          buildSettlementNotificationEmail({
            ...data,
            settlements: stillSettled,
            totalAmount,
          })
        );
        if (!emailResult.success) {
          logger.error({
            message: 'Settlement notification email rejected',
            merchantId: data.merchantId,
            error: emailResult,
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
        notificationResults.failed++;
      }
    }
  }

  return notificationResults;
}
