import { NextResponse } from 'next/server';
import { constantTimeEqual } from '@/lib/constant-time-equal';
import { logger } from '@/lib/logger';

/**
 * POST /api/cron/process-redvault-refunds
 *
 * Intentionally unavailable. Production refund recovery requires a
 * separately approved restricted-role transport with grants limited to
 * the REDVAULT refund RPC surface, an explicitly reviewed non-test
 * provider-key policy, an authenticated operator entrypoint, and verified
 * Paystack refund/reconciliation evidence (see docs/superpowers/plans/
 * uba-redvault-evidence/recovery-completion.md). None of those exist yet,
 * so this route must not drive the recovery runner in apply mode against
 * the live provider through the shared cron secret and an unrestricted
 * service-role client. Re-enable only by adding the approved restricted
 * transport — never by re-adding a service-role store here.
 *
 * Security: Requires Authorization: Bearer <CRON_SECRET>
 */
export function POST(request: Request) {
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

    // Activation boundary (see the header comment): no restricted-role
    // transport exists, so production recovery stays unavailable.
    logger.info({
      message: 'REDVAULT refund recovery is unavailable: no approved transport',
    });
    return NextResponse.json(
      { error: 'Refund recovery is not available' },
      { status: 503 }
    );
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
