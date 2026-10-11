// The full settlement path runs the cancellation side-effect drain LAST,
// after the settlement RPC and up to 50 notification emails burned through
// the 300s vps-workers cron budget (see timeoutMs in
// vps-workers/jobs/run-web-cron.mjs). Rebuilding a fresh phase budget here
// would run provider refund calls past the platform abort: the abort then
// lands between a provider acceptance and its audit insert, stranding an
// undiscoverable provider refund. Bound the drain by the REMAINING route
// budget instead, and skip it outright once the safety margin is gone —
// unlike the cancellations-only path, no notification phase runs behind
// this drain, so no notification reserve is subtracted. Shared with
// cancellation-side-effect-drain-limit: keep the budget constants
// identical.
const INVOCATION_BUDGET_MS = 5 * 60_000;
const SAFETY_MARGIN_MS = 30_000;
const PER_STEP_WORST_MS = 30_000;
const MAX_DRAIN_LIMIT = 10;

/** Absolute abort margin for the drain: the route must stop starting provider work by this time. */
export function settlementDrainDeadlineMs(
  invocationStartedAtMs: number
): number {
  return invocationStartedAtMs + INVOCATION_BUDGET_MS - SAFETY_MARGIN_MS;
}

/** How many serial cancellation side-effect steps fit in the remaining route budget. */
export function settlementDrainLimit(elapsedMs: number): number {
  const remaining = INVOCATION_BUDGET_MS - elapsedMs - SAFETY_MARGIN_MS;
  return Math.max(
    0,
    Math.min(MAX_DRAIN_LIMIT, Math.floor(remaining / PER_STEP_WORST_MS))
  );
}
