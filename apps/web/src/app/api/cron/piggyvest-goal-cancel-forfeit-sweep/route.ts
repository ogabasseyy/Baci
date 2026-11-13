import { NextResponse } from 'next/server';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { runScheduledGoalCancelForfeitSweep } from '@/lib/piggyvest/goal-cancel-forfeit-cron';

export const maxDuration = 300;
// No new forfeit starts after this much of the budget, so the one in flight
// (a wallet read, a posting mark, one POST and one status read, each with its
// client timeout) still ends well inside maxDuration.
const FORFEIT_SWEEP_BUDGET_MS = 200_000;

// Hourly sweep of early-cancel interest forfeits: sends forfeits nobody's
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
  return NextResponse.json({ status: 'ok', forfeitSweep: result });
}
