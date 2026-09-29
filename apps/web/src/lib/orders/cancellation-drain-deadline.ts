// vps-workers aborts POST /api/cron/process-settlements after 5 minutes
// (see timeoutMs in vps-workers/jobs/run-web-cron.mjs). Shared with
// cancellation-side-effect-drain-limit: keep both budgets identical.
const INVOCATION_BUDGET_MS = 5 * 60_000;
const SAFETY_MARGIN_MS = 30_000;
// A lower row count alone cannot protect the notification drain: a step
// started near the shared deadline would still pass the full remaining
// duration to Paystack and loop across legs into the reserved window.
// End side-effect work before one worst-case notification send so the
// reserve holds in time, not just arithmetically. Shared with
// notification-drain-limit PER_SEND_WORST_MS: keep both identical.
const NOTIFICATION_RESERVE_MS = 150_000;

/**
 * Absolute epoch-ms deadline for cancellation side-effect work started at
 * `startedAtMs`: the invocation budget minus the safety margin and the
 * notification reserve. Steps and provider calls check the remaining time
 * against this instead of trusting the fixed per-step estimate.
 */
export function cancellationDrainDeadlineMs(startedAtMs: number): number {
  return (
    startedAtMs +
    INVOCATION_BUDGET_MS -
    SAFETY_MARGIN_MS -
    NOTIFICATION_RESERVE_MS
  );
}
