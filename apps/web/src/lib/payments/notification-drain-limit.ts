// vps-workers aborts POST /api/cron/process-settlements after 5 minutes
// (see timeoutMs in vps-workers/jobs/run-web-cron.mjs). A notification send
// cut off mid-flight strands its row as processing, which the claim RPC
// later converts to permanently non-retryable delivery_uncertain — even when
// the mail actually went out. Budget the serial drain from the time the
// reconciliation workers actually consumed so only sends that fit run.
// Shared with notification-drain-deadline: keep both budgets identical.
const INVOCATION_BUDGET_MS = 5 * 60_000;
const SAFETY_MARGIN_MS = 30_000;
// Allow for ZeptoMail's four 30-second attempts and backoff, plus database
// reads and the outcome write. The per-row deadline still stops a slower send.
const PER_SEND_WORST_MS = 150_000;
const MAX_DRAIN_LIMIT = 20;

/** How many serial notification sends fit in the remaining cron budget. */
export function notificationDrainLimit(elapsedMs: number): number {
  const remaining = INVOCATION_BUDGET_MS - elapsedMs - SAFETY_MARGIN_MS;
  return Math.max(
    0,
    Math.min(MAX_DRAIN_LIMIT, Math.floor(remaining / PER_SEND_WORST_MS))
  );
}
