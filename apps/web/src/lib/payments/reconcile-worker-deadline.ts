// vps-workers aborts POST /api/cron/process-settlements after 5 minutes
// (see timeoutMs in vps-workers/jobs/run-web-cron.mjs). The two
// reconciliation workers share this bounded first phase: without it a
// full 25-row batch at the 8-second provider timeout each consumes the
// invocation, and the serial side-effect and notification drains behind
// it compute a zero limit and skip every row on every invocation. Rows
// the workers never reach stay pending for the next invocation.
const WORKER_BUDGET_MS = 60_000;
// A worker gates only row starts, while a started row may run provider
// reads past the deadline: the cancellation worker races two parallel
// reads to one 8-second timeout, but the recovery-watch sweep runs
// two SEQUENTIAL 8-second reads per redriven row (refund, then its
// payment). Without slack for both, a row starting near 52s ends near
// 68s, and that normal overrun zeroes cancellationSideEffectDrainLimit
// on every backlog invocation — starving cancellation refunds and
// emails while the watch backlog persists. Stop starting rows two
// provider-timeout intervals early so the phase still ends inside its
// budget. Shared with the AbortSignal.timeout calls in
// reconcile-paystack-cancellation-refund and
// verify-unknown-paystack-refund-provider: keep identical.
const ROW_START_SLACK_MS = 16_000;

/**
 * Epoch-ms row-start deadline for reconciliation work started at
 * `startedAtMs`: the last started row may overrun by two sequential
 * provider timeouts, so this sits that interval inside the phase
 * budget and the phase still ends within `WORKER_BUDGET_MS`.
 */
export function reconcileWorkerDeadlineMs(startedAtMs: number): number {
  return startedAtMs + WORKER_BUDGET_MS - ROW_START_SLACK_MS;
}

/** Sentinel deadline for worker calls with no bounding phase budget. */
export const NO_RECONCILE_DEADLINE = Number.POSITIVE_INFINITY;

/** Whether a worker should stop before starting another row. */
export function shouldYieldReconcileWorker(deadlineMs: number): boolean {
  return Date.now() >= deadlineMs;
}
