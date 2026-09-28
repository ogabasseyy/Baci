// vps-workers aborts POST /api/cron/process-settlements after 5 minutes
// (see timeoutMs in vps-workers/jobs/run-web-cron.mjs). Shared with
// cancellation-side-effect-drain-limit: keep both budgets identical.
const INVOCATION_BUDGET_MS = 5 * 60_000;
const SAFETY_MARGIN_MS = 30_000;

/**
 * Absolute epoch-ms deadline for cancellation side-effect work started at
 * `startedAtMs`: the invocation budget minus the safety margin. Steps and
 * provider calls check the remaining time against this instead of trusting
 * the fixed per-step estimate.
 */
export function cancellationDrainDeadlineMs(startedAtMs: number): number {
  return startedAtMs + INVOCATION_BUDGET_MS - SAFETY_MARGIN_MS;
}
