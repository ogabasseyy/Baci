// vps-workers treats maxDuration 300 as the server-side limit for GET
// /api/cron/reconcile-gateway-paid-orders (see timeoutMs in
// vps-workers/jobs/run-web-cron.mjs). Three serial passes share it: the
// abandoned-attempt sweep, the wedged-order sweep, and the paid
// side-effect drain. Split the budget into equal cumulative shares so a
// slow backlog in an early pass cannot starve the older recovery jobs
// behind it: each pass stops starting work at its share deadline and
// leaves the rest for the next invocation.
const INVOCATION_BUDGET_MS = 300_000;
const SAFETY_MARGIN_MS = 30_000;
const PASS_COUNT = 3;

/**
 * Absolute epoch-ms deadline for pass `passIndex` (0-based) of an
 * invocation started at `startedAtMs`. Cumulative: a pass that finishes
 * early leaves its unused share to the passes behind it.
 */
export function reconcileGatewayPassDeadlineMs(
  startedAtMs: number,
  passIndex: number
): number {
  const shareMs = (INVOCATION_BUDGET_MS - SAFETY_MARGIN_MS) / PASS_COUNT;
  return startedAtMs + (passIndex + 1) * shareMs;
}
