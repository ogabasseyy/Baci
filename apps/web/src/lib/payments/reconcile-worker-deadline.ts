// vps-workers aborts POST /api/cron/process-settlements after 5 minutes
// (see timeoutMs in vps-workers/jobs/run-web-cron.mjs). The two
// reconciliation workers share this bounded first phase: without it a
// full 25-row batch at the 8-second provider timeout each consumes the
// invocation, and the serial side-effect and notification drains behind
// it compute a zero limit and skip every row on every invocation. Rows
// the workers never reach stay pending for the next invocation.
const WORKER_BUDGET_MS = 60_000;

/** Absolute epoch-ms deadline for reconciliation work started at `startedAtMs`. */
export function reconcileWorkerDeadlineMs(startedAtMs: number): number {
  return startedAtMs + WORKER_BUDGET_MS;
}

/** Sentinel deadline for worker calls with no bounding phase budget. */
export const NO_RECONCILE_DEADLINE = Number.POSITIVE_INFINITY;

/** Whether a worker should stop before starting another row. */
export function shouldYieldReconcileWorker(deadlineMs: number): boolean {
  return Date.now() >= deadlineMs;
}
