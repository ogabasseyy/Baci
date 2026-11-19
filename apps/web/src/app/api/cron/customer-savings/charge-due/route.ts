import { NextResponse } from 'next/server';
import { getCronSecret } from '@/env';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { chargeDueCustomerSavingsGoals } from '@/lib/customer-savings-auto-debit';
import { createServiceClient } from '@/lib/supabase/service';

function formatChargeDueResponse(
  result: Awaited<ReturnType<typeof chargeDueCustomerSavingsGoals>>
) {
  return {
    errored: result.errored,
    failed: result.failed,
    processed: result.processed,
    skipped: result.skipped,
    success: result.errored === 0,
  };
}

// Scheduled execution lives in vps-workers; keep CRON_SECRET gating intact.
export async function POST(request: Request) {
  if (!hasValidCronSecret(request.headers, getCronSecret())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const result = await chargeDueCustomerSavingsGoals({ supabase });

    // An unexpected per-goal error fails the run so schedulers alert; ordinary
    // declines are counted in `failed` and keep it a successful run.
    return NextResponse.json(formatChargeDueResponse(result), {
      status: result.errored > 0 ? 500 : 200,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to charge due customer savings goals';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
