import { after, type NextRequest, NextResponse } from 'next/server';
import { getCronSecret } from '@/env';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { logger } from '@/lib/logger';
import { drainFailedPaidOrderSideEffects } from '@/lib/payments/drain-failed-paid-order-side-effects';
import {
  type AbandonedPaystackAttemptSummary,
  reconcileAbandonedPaystackAttempts,
} from '@/lib/payments/reconcile-abandoned-paystack-attempts';
import { reconcileWedgedGatewayOrders } from '@/lib/payments/reconcile-wedged-gateway-orders';
import { createServiceClient } from '@/lib/supabase/service';

// Manual fallback only — DO NOT re-enable Vercel Cron for this route.
// Scheduled execution lives in vps-workers (deploy.sh crontab →
// run-web-cron.mjs), which invokes this CRON_SECRET-gated endpoint over the
// custom domain; keep the CRON_SECRET gating intact. Three passes:
// 1. Retire Paystack attempts that the provider confirms were abandoned/failed.
// 2. Heal "wedged" gateway order payments — completed transaction, order
//    never flipped to paid — after re-verifying with the gateway.
// 3. Drain failed paid-order side effects (settlement/email/ad tracking)
//    for orders that ARE paid but whose outbox recorded a failure.
// Safety net behind the webhook's own heal-on-retry path.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronSecret = getCronSecret();
  if (!cronSecret) {
    logger.error({
      message: 'reconcile-gateway-paid-orders: CRON_SECRET is not configured',
    });
    return NextResponse.json(
      { error: 'server_misconfigured' },
      { status: 500 }
    );
  }

  if (!hasValidCronSecret(request.headers, cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const scheduleAfter = (task: () => Promise<void>) => after(task);
    let abandonedAttemptSweep: AbandonedPaystackAttemptSummary = {
      checked: 0,
      held: [],
      retired: [],
    };
    let abandonedAttemptSweepFailed = false;
    try {
      abandonedAttemptSweep = await reconcileAbandonedPaystackAttempts({
        supabase,
      });
    } catch (error) {
      abandonedAttemptSweepFailed = true;
      logger.error({
        error,
        message: 'reconcile-gateway-paid-orders Paystack attempt sweep failed',
      });
    }
    const summary = await reconcileWedgedGatewayOrders({
      scheduleAfter,
      supabase,
    });
    const sideEffectDrain = await drainFailedPaidOrderSideEffects({
      scheduleAfter,
      supabase,
    });

    if (
      abandonedAttemptSweep.checked > 0 ||
      abandonedAttemptSweepFailed ||
      summary.checked > 0 ||
      sideEffectDrain.drained.length > 0 ||
      sideEffectDrain.failed.length > 0 ||
      sideEffectDrain.recovered.length > 0 ||
      sideEffectDrain.stranded.length > 0
    ) {
      logger.warn({
        message:
          'reconcile-gateway-paid-orders found gateway payment records to reconcile',
        abandonedAttemptSweep,
        abandonedAttemptSweepFailed,
        sideEffectDrain,
        summary,
      });
    }

    return NextResponse.json({
      checked_at: new Date().toISOString(),
      abandonedAttemptSweep,
      abandonedAttemptSweepFailed,
      ...summary,
      sideEffectDrain,
    });
  } catch (error) {
    logger.error({
      error,
      message: 'reconcile-gateway-paid-orders cron failed',
    });
    return NextResponse.json({ error: 'Cron job failed' }, { status: 500 });
  }
}
