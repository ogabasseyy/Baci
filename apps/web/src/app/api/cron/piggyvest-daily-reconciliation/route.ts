import { NextResponse } from 'next/server';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { runPiggyvestDailyReconciliation } from '@/lib/piggyvest/daily-reconciliation-runtime';

export const maxDuration = 300;

// Daily PiggyVest reconciliation (read-only). Inert until the owner sets
// PIGGYVEST_RECONCILIATION_ENABLED=true; then it emails the report and pages
// on a mismatch. The response carries counts only, never wallet or transfer
// detail.
export async function GET(request: Request) {
  if (!hasValidCronSecret(request.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await runPiggyvestDailyReconciliation());
  } catch {
    return NextResponse.json(
      { error: 'Reconciliation failed' },
      { status: 500 }
    );
  }
}
