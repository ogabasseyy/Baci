import { NextResponse } from 'next/server';
import { constantTimeEqual } from '@/lib/constant-time-equal';
import { logger } from '@/lib/logger';
import { createRedvaultPaystackRefundProvider } from '@/lib/payments/redvault-refund-paystack-provider';
import {
  REDVAULT_PRODUCTION_REFUND_APPLY_GUARD,
  runRedvaultRefundRecovery,
} from '@/lib/payments/redvault-refund-recovery-runner';
import type { RedvaultRefundRpcClient } from '@/lib/payments/redvault-refund-store';
import { RedvaultRefundStore } from '@/lib/payments/redvault-refund-store';
import { createServiceClient } from '@/lib/supabase/service';

const recoveryLogger = {
  error: (entry: Record<string, string>) =>
    logger.error({ message: 'REDVAULT refund recovery', ...entry }),
  info: (entry: Record<string, string>) =>
    logger.info({ message: 'REDVAULT refund recovery', ...entry }),
};

/**
 * POST /api/cron/process-redvault-refunds
 *
 * Manual fallback only - DO NOT re-enable Vercel Cron for this route.
 * Scheduled execution lives in vps-workers; keep CRON_SECRET gating intact.
 *
 * Drives one REDVAULT refund submission pass plus one reconciliation pass
 * through the live Paystack provider. Without this worker,
 * operator-reserved refunds sit in pending forever: the recovery runner
 * refuses to run outside an explicit apply guard.
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

    // Fail closed: without a provider secret every lookup would resolve
    // indeterminate and stall reserved refunds instead of processing them.
    if (!process.env.PAYSTACK_SECRET_KEY) {
      logger.error({
        message: 'PAYSTACK_SECRET_KEY is not configured for REDVAULT refunds',
      });
      return NextResponse.json(
        { error: 'Refund provider is not configured' },
        { status: 500 }
      );
    }

    const outcome = await runRedvaultRefundRecovery({
      applyGuard: REDVAULT_PRODUCTION_REFUND_APPLY_GUARD,
      logger: recoveryLogger,
      mode: 'apply',
      provider: createRedvaultPaystackRefundProvider({
        getSecret: () => process.env.PAYSTACK_SECRET_KEY,
      }),
      providerEnvironment: 'production',
      store: new RedvaultRefundStore(
        createServiceClient() as unknown as RedvaultRefundRpcClient
      ),
    });

    return NextResponse.json({ success: true, ...outcome });
  } catch (error) {
    logger.error({
      message: 'REDVAULT refund processing cron error',
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
    headers: request.headers,
    method: 'POST',
  });
  return POST(mockRequest);
}
