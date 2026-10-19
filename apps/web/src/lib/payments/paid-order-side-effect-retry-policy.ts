// Shared retry-policy constants for the paid-order side-effect outbox
// (payment_side_effects).

// Hard ceiling on automatic claim/drain attempts. A deterministic failure that
// survives this many tries stops being retried by the normal drain so a broken
// side effect cannot loop forever. Rows that hit the cap are surfaced and
// slow-lane recovered by `recoverStrandedPaidOrderSideEffects` rather than left
// permanently stranded.
//
// This value MUST match the SQL claim RPC `claim_payment_side_effect`
// (migration 20260721093205), whose ON CONFLICT guard uses the same
// `attempts < CAP` ceiling — if they drift, the drain/recovery could re-select
// a row the RPC refuses to re-claim (or vice versa).
export const PAID_ORDER_SIDE_EFFECT_ATTEMPT_CAP = 5;

// Errors known to be permanent: retrying cannot help, so rows carrying them are
// excluded from both the drain and stranded-row recovery SELECTs.
//
// NOTE: this list is a DRAIN/RECOVERY-side selection filter only. The SQL claim
// RPC does NOT know these errors — its `attempts < CAP` ceiling is the sole
// RPC-level backstop, so a permanent-error row can still re-climb attempts up to
// the cap if some other caller re-invokes the finalizer for it. That is
// intentional: the hourly sweep never re-runs these rows (this filter), and the
// attempt cap bounds any other caller. Do not assume the RPC enforces this list.
export const PERMANENT_PAID_ORDER_SIDE_EFFECT_ERRORS = [
  'wired_in_b3_5',
  'financial_totals_inconsistent',
  'gateway_verification_terminal',
  'settlement_order_cancelled',
] as const;
