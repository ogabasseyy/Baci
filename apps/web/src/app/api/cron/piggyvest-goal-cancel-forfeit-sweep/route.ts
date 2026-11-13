import { NextResponse } from 'next/server';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { runScheduledGoalCancelForfeitSweep } from '@/lib/piggyvest/goal-cancel-forfeit-cron';

export const maxDuration = 300;
// No new forfeit starts after this much of the budget, so the one in flight
// (wallet check, posting mark, one POST, the status read and the residual
// wallet read, each with its 30 s client timeout, plus database round trips:
// about 150 s at worst) still ends inside maxDuration.
const FORFEIT_SWEEP_BUDGET_MS = 120_000;

// Daily sweep of early-cancel interest forfeits (run from the 23:00 VPS
// crontab entry right after the reconciliation report, with its own budget): sends forfeits nobody's
// status check picked up and settles in-flight ones (new transfers only while
// PiggyVest savings are switched on). Inert (204-like empty answer) until the
// PiggyVest savings credentials exist. The response carries counts only.
export async function GET(request: Request) {
  if (!hasValidCronSecret(request.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await runScheduledGoalCancelForfeitSweep(
    process.env,
    undefined,
    Date.now() + FORFEIT_SWEEP_BUDGET_MS
  );
  if (result === null) return NextResponse.json({ status: 'inert' });
  if ('status' in result)
    return NextResponse.json({ status: 'failed' }, { status: 500 });
  // A forfeit that threw (a failed claim or query) fails the scheduled run, so
  // the crontab's failure alerting sees it; the others were still driven.
  if (result.failed > 0)
    return NextResponse.json(
      { status: 'failed', forfeitSweep: result },
      { status: 500 }
    );
  return NextResponse.json({ status: 'ok', forfeitSweep: result });
}
