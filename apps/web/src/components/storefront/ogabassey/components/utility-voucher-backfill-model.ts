// Pure model for the utility voucher backfill loop: response parsing
// only (Codex R112 P1 — one primary export per file). Tab mapping
// lives in utility-voucher-backfill-tabs, terminality in
// utility-voucher-backfill-terminal, poll pacing in
// utility-voucher-backfill-polling. Extracted from
// use-utility-voucher-backfill.ts per the 300-line rule (Codex R86
// P1) — no React, no network, no session reads.
//
// Bill-style purchases may receive their voucher after the initial
// 202, once the provider reports back. Airtime/data ride the same
// loop for settlement tracking: without it a telco 202 would sit on
// "Processing" forever. Mirrors mobile's useVtuVoucherPinBackfill
// (plain loop; same intervals).
export interface UtilityVoucherBackfill {
  /** Failed observed; terminal only once refundConfirmed. */
  failed: boolean;
  /** Backfilled voucher/token; null until the provider reports it. */
  pin: string | null;
  /**
   * No refund outstanding. Fail-closed (explicit false only): a
   * missing flag keeps polling rather than claiming without proof.
   * Skipped rows never confirm (Codex R110 P2): nothing was
   * credited, so the copy must say no charge was made, not that a
   * refund landed.
   */
  refundConfirmed: boolean;
  /**
   * Refund deliberately skipped (no collection evidence — nothing
   * was taken). Terminal like a confirmation (pollers stop), but
   * the copy differs. Explicit true only.
   */
  refundSkipped: boolean;
  /** Amount credited back, when known. */
  refundedAmount: number | null;
  /** Successful observed — even when no voucher is expected. */
  successful: boolean;
}

export const INITIAL_UTILITY_VOUCHER_BACKFILL: UtilityVoucherBackfill = {
  failed: false,
  pin: null,
  refundConfirmed: false,
  refundSkipped: false,
  refundedAmount: null,
  successful: false,
};

interface HistoryTransactionRow {
  refund_pending?: unknown;
  refund_skipped?: unknown;
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
      refundSkipped: false,
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
    refundConfirmed:
      match.refund_pending === false && match.refund_skipped === false,
    refundSkipped:
      match.status === 'failed' && match.refund_skipped === true,
    refundedAmount,
    successful: match.status === 'successful',
  };
}
