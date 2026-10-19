import { type NextRequest, NextResponse } from 'next/server';
import { getCronSecret } from '@/env';
import { constantTimeEqual } from '@/lib/constant-time-equal';
import { logger } from '@/lib/logger';
import { createAdminClient } from '@/lib/supabase/admin';
import { reconcileProcessingVtuTransactions } from '@/lib/vtu-processing-reconciliation';

export const maxDuration = 300;

function hasValidCronSecret(request: NextRequest) {
  const expectedSecret = getCronSecret();
  if (!expectedSecret) {
    return { configured: false, valid: false };
  }

  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : null;

  return {
    configured: true,
    valid: !!bearerToken && constantTimeEqual(bearerToken, expectedSecret),
  };
}

export async function GET(request: NextRequest) {
  const invocationStartedAt = Date.now();
  const auth = hasValidCronSecret(request);
  if (!auth.configured) {
    return NextResponse.json(
      { error: 'Server misconfigured', code: 'server_misconfigured' },
      { status: 500 }
    );
  }
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await reconcileProcessingVtuTransactions({
      deadlineMs: invocationStartedAt + maxDuration * 1000,
      supabase: createAdminClient(),
    });
    if (summary.errored > 0) {
      logger.warn({
        message: 'Processing VTU reconciliation cron completed with errors',
        summary,
      });
    }
    return NextResponse.json(summary);
  } catch (error) {
    logger.error({
      message: 'Processing VTU reconciliation cron failed',
      error,
    });
    return NextResponse.json(
      { error: 'Internal server error', code: 'internal_error' },
      { status: 500 }
    );
  }
}
