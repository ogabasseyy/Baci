import { NextResponse } from 'next/server';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { runPiggyvestDailyReconciliation } from '@/lib/piggyvest/daily-reconciliation-runtime';
import { runScheduledGoalCancelForfeitSweep } from '@/lib/piggyvest/goal-cancel-forfeit-cron';

export const maxDuration = 300;
// The forfeit sweep starts no new forfeit after this much of the budget, so
// one started forfeit (provider timeouts included) still ends in time.
const FORFEIT_SWEEP_BUDGET_MS = 200_000;

// Daily PiggyVest reconciliation (read-only). Inert until the owner sets
// PIGGYVEST_RECONCILIATION_ENABLED=true; then it emails the report and pages
// on a mismatch. The response carries counts only, never wallet or transfer
// detail. After the report it runs the early-cancel interest forfeit sweep
// (inert until the PiggyVest savings credentials exist; bounded by a
// deadline, never fails the report or the response).
export async function GET(request: Request) {
  if (!hasValidCronSecret(request.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const startedAt = Date.now();
  let report: Awaited<
    ReturnType<typeof runPiggyvestDailyReconciliation>
  > | null = null;
  try {
    report = await runPiggyvestDailyReconciliation();
  } catch (error) {
    // The reason only (never wallet or transfer detail), then the sweep runs.
    console.warn(
      '[PiggyVest] Daily reconciliation failed:',
      error instanceof Error ? error.message : 'unknown error'
    );
    report = null;
  }
  const forfeitSweep = await runScheduledGoalCancelForfeitSweep(
    process.env,
    undefined,
    startedAt + FORFEIT_SWEEP_BUDGET_MS
  );
  // Counts on success; a failed sweep is reported under its own field so the
  // counts shape stays numeric for anything reading it.
  const sweepFields =
    forfeitSweep === null
      ? {}
      : 'status' in forfeitSweep
        ? { forfeitSweepError: forfeitSweep.status }
        : { forfeitSweep };
  if (report === null)
    return NextResponse.json(
      { error: 'Reconciliation failed', ...sweepFields },
      { status: 500 }
    );
  return NextResponse.json({ ...report, ...sweepFields });
}
