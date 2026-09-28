import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildSettlementNotificationEmail } from '@/lib/build-settlement-notification-email';
import { constantTimeEqual } from '@/lib/constant-time-equal';
import { notifyMerchant } from '@/lib/expo-push';
import { logger } from '@/lib/logger';
import { drainFailedOrderCancellationSideEffects } from '@/lib/orders/drain-failed-order-cancellation-side-effects';
import { createServiceClient } from '@/lib/supabase/service';
import { sendEmail } from '@/lib/zeptomail';
import { processCancellationDrain } from './process-cancellation-drain';

/**
 * POST /api/cron/process-settlements
 *
 * Manual fallback only - DO NOT re-enable Vercel Cron for this route.
 * Scheduled execution lives in vps-workers; keep CRON_SECRET gating intact.
 *
 * Daily settlement job to:
 * 1. Process settlements that have reached their expected date
 * 2. Send notifications to merchants about new settlements
 * 3. Retry deterministic merchant-cancellation refund/email failures
 *
 * Security: Requires Authorization: Bearer <CRON_SECRET>
 */
export async function POST(request: Request) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('Authorization');
    const cronSecret = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : null;
    const expectedSecret = process.env.CRON_SECRET;

    if (
      !cronSecret ||
      !expectedSecret ||
      !constantTimeEqual(cronSecret, expectedSecret)
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Validate before any database work: a malformed flag must never
    // silently fall through to the full settlement job.
    const parsedCancellationsOnly = z
      .enum(['true', 'false'])
      .optional()
      .safeParse(
        new URL(request.url).searchParams.get('cancellationsOnly') ?? undefined
      );
    if (!parsedCancellationsOnly.success) {
      return NextResponse.json(
        { error: 'Invalid cancellationsOnly value' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    if (parsedCancellationsOnly.data === 'true') {
      return processCancellationDrain(supabase, sendEmail, notifyMerchant);
    }

    // 1. Process due settlements
    const { data: processResult, error: processError } = await supabase.rpc(
      'process_due_settlements'
    );

    if (processError) {
      logger.error({
        message: 'Failed to process due settlements',
        error: processError,
      });
      return NextResponse.json(
        { error: 'Failed to process settlements' },
        { status: 500 }
      );
    }

    const result = processResult?.[0] || {
      processed_count: 0,
      total_amount: 0,
      details: [],
    };

    logger.info({
      message: 'Processed due settlements',
      processedCount: result.processed_count,
      totalAmount: result.total_amount,
    });

    // 2. Get settlements that need notifications
    const { data: pendingNotifications, error: notifyError } = await supabase
      .from('merchant_settlements')
      // PostgREST cannot embed auth.users through merchants here; use the
      // merchant contact email denormalized on public.merchants instead.
      .select(
        `
        id,
        merchant_id,
        net_amount,
        gateway,
        source_type,
        description,
        actual_settlement_date,
        merchants (
          id,
          business_name,
          email
        )
      `
      )
      .eq('status', 'settled')
      .eq('settlement_notified', false)
      .order('actual_settlement_date', { ascending: true })
      .limit(50); // Process in batches

    if (notifyError) {
      logger.warn({
        message: 'Failed to fetch pending notifications',
        error: notifyError,
      });
    }

    // 3. Send notifications
    const notificationResults = {
      sent: 0,
      failed: 0,
    };

    if (pendingNotifications && pendingNotifications.length > 0) {
      // Group settlements by merchant for batch notifications
      const merchantSettlements = new Map<
        string,
        {
          merchantId: string;
          businessName: string;
          email: string;
          settlements: Array<{
            id: string;
            amount: number;
            gateway: string;
            description: string;
          }>;
          totalAmount: number;
        }
      >();

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

          await sendEmail(buildSettlementNotificationEmail(data));

          // Mark as notified
          await supabase
            .from('merchant_settlements')
            .update({
              settlement_notified: true,
              notification_sent_at: new Date().toISOString(),
            })
            .in('id', settlementIds);

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

    const cancellationSideEffectDrain =
      await drainFailedOrderCancellationSideEffects({
        sendCancellationEmail: sendEmail,
        supabase,
      });
    return NextResponse.json({
      success: true,
      cancellationSideEffectDrain,
      settlements: {
        processed: result.processed_count,
        totalAmount: result.total_amount,
      },
      notifications: notificationResults,
    });
  } catch (error) {
    logger.error({
      message: 'Settlement processing cron error',
      error,
    });
    return NextResponse.json({ error: 'Cron job failed' }, { status: 500 });
  }
}

// Allow GET for testing in development
export function GET(request: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const mockRequest = new Request(request.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CRON_SECRET || 'dev-secret'}`,
    },
  });

  return POST(mockRequest);
}
