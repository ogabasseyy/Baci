// vps-workers aborts POST /api/cron/process-settlements after 5 minutes
// (see timeoutMs in vps-workers/jobs/run-web-cron.mjs). A cancellation
// side-effect step cut off after its claim strands the row as claimed,
// which the next drain converts to permanently non-retryable
// delivery_uncertain — even when the refund/email actually went out.
// Budget the serial drain from the time the reconciliation workers
// actually consumed so only steps that fit run. Skipped rows stay failed
// for the next invocation.
const INVOCATION_BUDGET_MS = 5 * 60_000;
const SAFETY_MARGIN_MS = 30_000;
const PER_STEP_WORST_MS = 30_000;
const MAX_DRAIN_LIMIT = 10;

/** How many serial cancellation side-effect steps fit in the remaining cron budget. */
export function cancellationSideEffectDrainLimit(elapsedMs: number): number {
  const remaining = INVOCATION_BUDGET_MS - elapsedMs - SAFETY_MARGIN_MS;
  return Math.max(
    0,
    Math.min(MAX_DRAIN_LIMIT, Math.floor(remaining / PER_STEP_WORST_MS))
  );
}

/**
 * Absolute epoch-ms deadline for cancellation side-effect work started at
 * `startedAtMs`: the invocation budget minus the safety margin. Steps and
 * provider calls check the remaining time against this instead of trusting
 * the fixed per-step estimate.
 */
export function cancellationDrainDeadlineMs(startedAtMs: number): number {
  return startedAtMs + INVOCATION_BUDGET_MS - SAFETY_MARGIN_MS;
}
