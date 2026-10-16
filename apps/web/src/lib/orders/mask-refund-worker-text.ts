// Success payloads carry the RPC's pre-mapped summary error and the
// structured Paystack signal the panel's requires-review guidance
// needs. Both are derived at the data layer because direct REST
// callers bypass this route; still, validate at the boundary so a
// mapper regression or a reachable legacy row can never leak worker
// internals to the panel. Unknown shapes fall back to the generic
// label and unknown top-level keys are dropped (direct REST callers
// keep working; only this route's contract narrows). Shared with
// the order page's server-side initial summary so both paths mask
// identically.
const REFUND_WORKER_ERROR_LABELS = new Set([
  'Refund in progress — waiting for the remaining money to arrive.',
  'Refund in progress — queued to resume automatically.',
  'This refund needs review before it can continue.',
  'The refund ran into a problem. Support has the details.',
]);
const REFUND_SUMMARY_KEYS = new Set([
  'currency',
  'amountPaid',
  'refunded',
  'remaining',
  'pending',
  'reversedInternal',
  'status',
  'error',
  'needsPaystackCheck',
  'attempts',
  'retryRequests',
  'history',
  'legs',
  'events',
  'canRetry',
  'canRecordManual',
  'canManageRefunds',
]);
export function maskRefundWorkerText(data: Record<string, unknown>) {
  const masked: Record<string, unknown> = {};
  for (const key of REFUND_SUMMARY_KEYS) {
    if (key in data) masked[key] = data[key];
  }
  masked.needsPaystackCheck = data.needsPaystackCheck === true;
  masked.error =
    data.error === null || data.error === undefined
      ? null
      : REFUND_WORKER_ERROR_LABELS.has(data.error as string)
        ? data.error
        : 'The refund ran into a problem. Support has the details.';
  return masked;
}
