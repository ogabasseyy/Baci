// vps-workers aborts POST /api/cron/process-settlements after 5 minutes
// (see timeoutMs in vps-workers/jobs/run-web-cron.mjs). Shared with
// notification-drain-limit: keep both budgets identical.
const INVOCATION_BUDGET_MS = 5 * 60_000;
const SAFETY_MARGIN_MS = 30_000;

/** Absolute epoch-ms deadline for notification work started at `startedAtMs`. */
export function notificationDrainDeadlineMs(startedAtMs: number): number {
  return startedAtMs + INVOCATION_BUDGET_MS - SAFETY_MARGIN_MS;
}
