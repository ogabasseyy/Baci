// Pure model for the utility voucher backfill loop: history-tab
// classification, poll pacing, response parsing, and terminality.
// Extracted from use-utility-voucher-backfill.ts per the 300-line
// rule (Codex R86 P1) — no React, no network, no session reads.
//
// Bill-style purchases may receive their voucher after the initial
// 202, once the provider reports back. Airtime/data ride the same
// loop for settlement tracking: without it a telco 202 would sit on
// "Processing" forever. Mirrors mobile's useVtuVoucherPinBackfill
// (plain loop; same intervals).
export const UTILITY_VOUCHER_BACKFILL_POLL_INTERVAL_MS = 3000;
export const UTILITY_VOUCHER_BACKFILL_SLOW_INTERVAL_MS = 10_000;
export const UTILITY_VOUCHER_BACKFILL_PATIENT_INTERVAL_MS = 60_000;
export const UTILITY_VOUCHER_BACKFILL_FAST_ATTEMPTS = 10;
export const UTILITY_VOUCHER_BACKFILL_SLOW_ATTEMPTS = 43;
export const UTILITY_VOUCHER_BACKFILL_MAX_ATTEMPTS = 73;
export const UTILITY_VOUCHER_BACKFILL_REQUEST_TIMEOUT_MS = 10_000; // One hung read must not stall later attempts.

export const TAB_TO_HISTORY_TYPE: Record<string, string> = {
  airtime: 'airtime',
  data: 'data',
  power: 'electricity',
  tv: 'cable_tv',
  betting: 'betting',
};

/** History types whose success may still gain a late token. */
export const TOKEN_BACKFILL_HISTORY_TYPES: ReadonlySet<string> = new Set([
  'electricity',
  'cable_tv',
  'betting',
]);

export function isUtilityBackfillTab(tab: string): boolean {
  return TAB_TO_HISTORY_TYPE[tab] !== undefined;
}

export function isTokenBackfillTab(tab: string): boolean {
  const historyType = TAB_TO_HISTORY_TYPE[tab];
  return (
    historyType !== undefined && TOKEN_BACKFILL_HISTORY_TYPES.has(historyType)
  );
}

export interface UtilityVoucherBackfill {
  /** Failed observed; terminal only once refundConfirmed. */
  failed: boolean;
  /** Backfilled voucher/token; null until the provider reports it. */
  pin: string | null;
  /**
   * No refund outstanding. Fail-closed (explicit false only): a
   * missing flag keeps polling rather than claiming without proof.
   */
  refundConfirmed: boolean;
  /** Amount credited back, when known. */
  refundedAmount: number | null;
  /** Successful observed — even when no voucher is expected. */
  successful: boolean;
}

export const INITIAL_UTILITY_VOUCHER_BACKFILL: UtilityVoucherBackfill = {
  failed: false,
  pin: null,
  refundConfirmed: false,
  refundedAmount: null,
  successful: false,
};

interface HistoryTransactionRow {
  refund_pending?: unknown;
  refunded_to_wallet?: unknown;
  request_reference?: unknown;
  status?: unknown;
  voucher_pin?: unknown;
}

/**
 * Extracts the backfill outcome for one reference. Returns null on a
 * schema mismatch (the caller halts: polling a broken contract burns
 * attempts returning nothing). A missing row, a pin-less non-terminal
 * row, or a failed row with a pending refund keeps polling.
 */
export function parseUtilityVoucherBackfill(
  body: unknown,
  reference: string
): UtilityVoucherBackfill | null {
  const transactions = (body as { transactions?: unknown } | null)
    ?.transactions;
  if (!Array.isArray(transactions)) {
    return null;
  }
  const match = transactions.find(
    (row) =>
      (row as HistoryTransactionRow | null)?.request_reference === reference
  ) as HistoryTransactionRow | undefined;
  if (!match) {
    return {
      failed: false,
      pin: null,
      refundConfirmed: false,
      refundedAmount: null,
      successful: false,
    };
  }
  const pin =
    typeof match.voucher_pin === 'string' ? match.voucher_pin.trim() : '';
  const refundedAmount =
    typeof match.refunded_to_wallet === 'number'
      ? match.refunded_to_wallet
      : null;
  return {
    failed: match.status === 'failed',
    pin: pin || null,
    refundConfirmed: match.refund_pending === false,
    refundedAmount,
    successful: match.status === 'successful',
  };
}

/**
 * Terminal backfill: show it and stop polling. A pin always stops the
 * hunt. A successful row keeps polling while a token may still arrive
 * (the server schedules late token backfills for pin-less successes
 * of these types); tokenless successes and confirmed failures settle.
 */
export function isTerminalBackfill(
  backfill: UtilityVoucherBackfill,
  tokenExpected: boolean
): boolean {
  if (backfill.pin !== null) {
    return true;
  }
  if (backfill.successful) {
    return !tokenExpected;
  }
  return backfill.failed && backfill.refundConfirmed;
}

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
