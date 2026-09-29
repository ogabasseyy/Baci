// vps-workers aborts POST /api/cron/process-settlements after 5 minutes
// (see timeoutMs in vps-workers/jobs/run-web-cron.mjs). A cancellation
// side-effect step cut off after its claim strands the row as claimed,
// which the next drain converts to permanently non-retryable
// delivery_uncertain — even when the refund/email actually went out.
// Budget the serial drain from the time the reconciliation workers
// actually consumed so only steps that fit run. Skipped rows stay failed
// for the next invocation. Shared with cancellation-drain-deadline: keep
// both budgets identical.
const INVOCATION_BUDGET_MS = 5 * 60_000;
const SAFETY_MARGIN_MS = 30_000;
const PER_STEP_WORST_MS = 30_000;
const MAX_DRAIN_LIMIT = 10;
// Reserve one worst-case notification send behind this drain: without it
// the side-effect steps run to the shared deadline and the notification
// drain behind them computes a zero limit on every invocation, starving
// already-queued refund emails and pushes indefinitely. Shared with
// notification-drain-limit PER_SEND_WORST_MS: keep both identical.
const NOTIFICATION_RESERVE_MS = 150_000;

/** How many serial cancellation side-effect steps fit in the remaining cron budget. */
export function cancellationSideEffectDrainLimit(elapsedMs: number): number {
  const remaining =
    INVOCATION_BUDGET_MS -
    elapsedMs -
    SAFETY_MARGIN_MS -
    NOTIFICATION_RESERVE_MS;
  return Math.max(
    0,
    Math.min(MAX_DRAIN_LIMIT, Math.floor(remaining / PER_STEP_WORST_MS))
  );
}
