// Poll pacing for the utility voucher backfill loop.
//
// Split from `utility-voucher-backfill-model.ts` (Codex R112 P1 — one
// primary export per file): sleep/delay/intervals govern WHEN polls
// run, independent of parsing, terminality, and tab mapping.
export const UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS = 3000;
export const UTILITY_VOUCHER_BACKFILL_SLOW_INTERVAL_MS = 10_000;
export const UTILITY_VOUCHER_BACKFILL_PATIENT_INTERVAL_MS = 60_000;
export const UTILITY_VOUCHER_BACKFILL_FAST_ATTEMPTS = 10;
export const UTILITY_VOUCHER_BACKFILL_SLOW_ATTEMPTS = 43;
export const UTILITY_VOUCHER_BACKFILL_MAX_ATTEMPTS = 73;
export const UTILITY_VOUCHER_BACKFILL_REQUEST_TIMEOUT_MS = 10_000; // One hung read must not stall later attempts.

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Backoff: 3s x10 (fast confirmations), 10s to #43 (~6min — one
 * reconciler pass), 60s to #73 (~36min). The patient lane matters:
 * the reconciler rotates one 25-row page per 5min window, so a
 * backlog row settles after a 6min loop quits — and the stale guard
 * only fires past an OBSERVED completion, so the retained entry
 * would replay the old vend as new (R55 6rrU6M).
 */
export function backfillPollDelayMs(attempt: number): number {
  if (attempt <= UTILITY_VOUCHER_BACKFILL_FAST_ATTEMPTS) {
    return UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS;
  }
  if (attempt <= UTILITY_VOUCHER_BACKFILL_SLOW_ATTEMPTS) {
    return UTILITY_VOUCHER_BACKFILL_SLOW_INTERVAL_MS;
  }
  return UTILITY_VOUCHER_BACKFILL_PATIENT_INTERVAL_MS;
}
