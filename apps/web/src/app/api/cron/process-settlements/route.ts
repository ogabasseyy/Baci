import { NextResponse } from 'next/server';
import { constantTimeEqual } from '@/lib/constant-time-equal';
import { notifyMerchant } from '@/lib/expo-push';
import { logger } from '@/lib/logger';
import { drainFailedOrderCancellationSideEffects } from '@/lib/orders/drain-failed-order-cancellation-side-effects';
import { createServiceClient } from '@/lib/supabase/service';
import { sendEmail } from '@/lib/zeptomail';
import { processSettlementsQuerySchema } from '@/schemas/process-settlements-query';
import { processCancellationDrain } from './process-cancellation-drain';
import {
  SETTLEMENT_NOTIFICATION_MAX_ATTEMPTS,
  sendSettlementNotifications,
} from './send-settlement-notifications';
import {
  settlementDrainDeadlineMs,
  settlementDrainLimit,
} from './settlement-drain-budget';

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
export const maxDuration = 300;

export async function POST(request: Request) {
  const invocationStartedAt = Date.now();
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
    const parsedQuery = processSettlementsQuerySchema.safeParse({
      cancellationsOnly:
        new URL(request.url).searchParams.get('cancellationsOnly') ?? undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: 'Invalid cancellationsOnly value' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    if (parsedQuery.data.cancellationsOnly === 'true') {
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

    // 2. Get settlements that need notifications. Rejected rows
    // carry backoff state: without the retry-due and attempt-cap
    // filters, permanently failing rows would pin this bounded
    // oldest-first queue and newer merchants would never send.
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
        notification_attempts,
        merchants (
          id,
          business_name,
          email
        )
      `
      )
      .eq('status', 'settled')
      .eq('settlement_notified', false)
      .lt('notification_attempts', SETTLEMENT_NOTIFICATION_MAX_ATTEMPTS)
      .or(
        `notification_next_retry_at.is.null,notification_next_retry_at.lte.${new Date().toISOString()}`
      )
      .order('actual_settlement_date', { ascending: true })
      .limit(50); // Process in batches

    if (notifyError) {
      logger.warn({
        message: 'Failed to fetch pending notifications',
        error: notifyError,
      });
    }

    // 3. Send notifications
    const notificationResults = await sendSettlementNotifications({
      pendingNotifications,
      sendEmail,
      supabase,
    });

    // The settlement RPC and notification emails above burned through the
    // shared 300s cron budget: bound the drain by what remains so provider
    // refund calls stop before the platform abort, and skip it outright
    // once the margin is gone rather than stranding an accepted refund
    // without its audit row.
    const drainLimit = settlementDrainLimit(Date.now() - invocationStartedAt);
    const cancellationSideEffectDrain =
      drainLimit > 0
        ? await drainFailedOrderCancellationSideEffects({
            deadlineMs: settlementDrainDeadlineMs(invocationStartedAt),
            limit: drainLimit,
            sendCancellationEmail: sendEmail,
            supabase,
          })
        : { drained: [], failed: [], skipped: [] };
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
