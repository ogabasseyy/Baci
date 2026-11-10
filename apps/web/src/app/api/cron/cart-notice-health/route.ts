import { type NextRequest, NextResponse } from 'next/server';
import { constantTimeEqual } from '@/lib/constant-time-equal';
import { logger } from '@/lib/logger';
import { createPublicClient } from '@/lib/supabase/public';

/** Stable tag operators alert on. */
const DELIVERY_FAULT_LOG_TAG = 'shared-cart notice_delivery_fault';

interface CartNoticeHealth {
  healthy: boolean;
  staleUndelivered: number;
  deadLettered24h: number;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isCartNoticeHealth(value: unknown): value is CartNoticeHealth {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.healthy === 'boolean' &&
    isCount(candidate.staleUndelivered) &&
    isCount(candidate.deadLettered24h)
  );
}

/**
 * Alarm for shared-cart live updates. The database sends each change notice
 * at write time and sweeps the rest; this check fails (non-2xx, error log)
 * when notices sit undelivered or were abandoned, so a silent delivery
 * outage is noticed in minutes. Counts only: no cart or merchant data.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (
    !authHeader ||
    !cronSecret ||
    !constantTimeEqual(authHeader, `Bearer ${cronSecret}`)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let data: unknown;
  let pgCode: string | undefined;
  let failed = false;
  try {
    const supabase = createPublicClient({
      clientInfo: 'baci-cart-notice-health',
      timeoutMs: 10_000,
    });
    const result = await supabase.rpc('commerce_cart_publish_health');
    data = result.data;
    pgCode = result.error?.code;
    failed = Boolean(result.error);
  } catch {
    failed = true;
  }

  if (failed || !isCartNoticeHealth(data)) {
    logger.error({
      message: DELIVERY_FAULT_LOG_TAG,
      reason: failed ? 'health_rpc_failed' : 'invalid_health_result',
      pgCode,
    });
    return NextResponse.json(
      { error: 'Cart notice health check failed' },
      { status: 500 }
    );
  }

  // The database's own verdict is not trusted on its own: any stale or
  // abandoned notice is a fault even if `healthy` were reported true.
  const healthy =
    data.healthy && data.staleUndelivered === 0 && data.deadLettered24h === 0;
  if (!healthy) {
    logger.error({
      message: DELIVERY_FAULT_LOG_TAG,
      reason: 'notices_not_delivered',
      staleUndelivered: data.staleUndelivered,
      deadLettered24h: data.deadLettered24h,
    });
    return NextResponse.json(
      {
        healthy: false,
        staleUndelivered: data.staleUndelivered,
        deadLettered24h: data.deadLettered24h,
      },
      { status: 503 }
    );
  }
  return NextResponse.json({ healthy: true });
}
