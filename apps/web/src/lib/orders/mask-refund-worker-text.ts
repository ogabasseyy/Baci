// Success payloads carry the RPC's pre-mapped summary error and the
// structured Paystack signal the panel's requires-review guidance
// needs. Both are derived at the data layer because direct REST
// callers bypass this route; still, validate at the boundary so a
// mapper regression or a reachable legacy row can never leak worker
// internals to the panel. Unknown shapes fall back to the generic
// label, unknown top-level keys are dropped, and each audit event's
// details pass the same label allow-list (direct REST callers keep
// working; only this route's contract narrows). Shared with the
// order page's server-side initial summary so both paths mask
// identically.
const REFUND_WORKER_ERROR_LABELS = new Set([
  'Refund in progress — waiting for the remaining money to arrive.',
  'Refund in progress — queued to resume automatically.',
  'This refund needs review before it can continue.',
  'The refund ran into a problem. Support has the details.',
]);
const REFUND_GENERIC_LABEL =
  'The refund ran into a problem. Support has the details.';
// Event detail keys the audit trigger writes. Anything else in a
// details object comes from a legacy, backfilled, or future writer
// that bypassed the write-time mapper, so it is dropped rather
// than trusted.
const REFUND_EVENT_DETAIL_KEYS = new Set([
  'status',
  'attempts',
  'error',
  'retryRequests',
  'previousAttempts',
  'previousError',
]);
function maskRefundEventDetails(details: unknown): unknown {
  if (details === null || details === undefined) return details;
  if (typeof details !== 'object' || Array.isArray(details)) return {};
  const source = details as Record<string, unknown>;
  const masked: Record<string, unknown> = {};
  for (const key of REFUND_EVENT_DETAIL_KEYS) {
    if (!(key in source)) continue;
    const value = source[key];
    masked[key] =
      (key === 'error' || key === 'previousError') &&
      value !== null &&
      value !== undefined &&
      !REFUND_WORKER_ERROR_LABELS.has(value as string)
        ? REFUND_GENERIC_LABEL
        : value;
  }
  return masked;
}
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
        : REFUND_GENERIC_LABEL;
  // The timeline renders details.error/previousError directly: a
  // legacy or backfilled row that predates the write-time mapper
  // would leak raw worker text through the verbatim copy, so each
  // event's details pass the same label allow-list (unknown detail
  // keys are dropped with them).
  if (Array.isArray(masked.events)) {
    masked.events = masked.events.map((event) =>
      event !== null &&
      typeof event === 'object' &&
      !Array.isArray(event) &&
      'details' in event
        ? {
            ...(event as Record<string, unknown>),
            details: maskRefundEventDetails(
              (event as Record<string, unknown>).details
            ),
          }
        : event
    );
  }
  return masked;
}
