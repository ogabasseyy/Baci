/**
 * Helpers for computing authoritative pre-gateway store-credit ledger totals
 * and identifying pre-gateway order payment statuses across web and mobile.
 *
 * Mirrors the reversal- and status-filtering semantics in
 * `supabase/migrations/20261031001000_harden_finalize_store_credit_order_payment.sql`.
 */

function toNonNegativeAmount(raw: unknown): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export interface WalletLedgerSummary {
  netCredit: number;
  hasCompletedReversal: boolean;
}

/**
 * Returns true when an order payment_status represents an unsettled
 * pre-gateway state where `orders.amount_paid` records pre-gateway credit.
 */
export function isPreGatewayCreditStatus(status?: string | null): boolean {
  const normalized = (status ?? 'unpaid').trim().toLowerCase();
  return normalized === 'unpaid' || normalized === 'pending';
}

/**
 * Summarizes wallet ledger rows (`completed` redemptions minus `completed`
 * `order_reversal` rows) and reports whether any completed reversal exists so
 * callers can distrust stale order-row credit columns.
 */
export function summarizeWalletLedgerCredit(
  rows: unknown
): WalletLedgerSummary {
  if (!Array.isArray(rows)) {
    return { netCredit: 0, hasCompletedReversal: false };
  }

  let redeemed = 0;
  let reversed = 0;
  let hasCompletedReversal = false;

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as {
      amount?: unknown;
      source_type?: unknown;
      type?: unknown;
      status?: unknown;
    };
    const amount = toNonNegativeAmount(record.amount);

    if (
      record.source_type === 'order_reversal' &&
      record.status === 'completed'
    ) {
      hasCompletedReversal = true;
      if (amount > 0) {
        reversed += amount;
      }
      continue;
    }

    if (
      amount > 0 &&
      record.source_type === 'order_redemption' &&
      record.type === 'redemption' &&
      record.status === 'completed'
    ) {
      redeemed += amount;
    }
  }

  return {
    netCredit: Math.max(Math.round((redeemed - reversed) * 100) / 100, 0),
    hasCompletedReversal,
  };
}

/**
 * Sums net completed wallet redemptions (`source_type = 'order_redemption'`,
 * `type = 'redemption'`, `status = 'completed'`) minus completed `'order_reversal'`
 * rows for the order, clamped to `>= 0`.
 */
export function sumNetWalletLedgerCredit(rows: unknown): number {
  return summarizeWalletLedgerCredit(rows).netCredit;
}

/**
 * Sums unreversed device-savings redemption rows (`metadata` does not have
 * `reversed_at` stamped).
 */
export function sumActiveSavingsLedgerCredit(rows: unknown): number {
  if (!Array.isArray(rows)) return 0;

  let total = 0;

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as { amount?: unknown; metadata?: unknown };
    const metadata = record.metadata;
    if (
      metadata &&
      typeof metadata === 'object' &&
      'reversed_at' in metadata &&
      (metadata as { reversed_at?: unknown }).reversed_at !== undefined
    ) {
      continue;
    }
    total += toNonNegativeAmount(record.amount);
  }

  return Math.round(total * 100) / 100;
}

export interface OrderPreGatewayCreditInput {
  total: number;
  amountPaid?: number | null;
  walletAmountUsed?: number | null;
  walletLedgerUsed?: number | null;
  savingsLedgerUsed?: number | null;
  paymentStatus?: string | null;
  walletReversalCompleted?: boolean | null;
}

/**
 * Derives authoritative pre-gateway store credit applied to an order.
 * When a completed wallet reversal exists, stale `orders.amount_paid` and
 * `orders.wallet_amount_used` columns are ignored so reversed credit cannot be
 * subtracted again.
 */
export function computeOrderPreGatewayPaid(
  input: OrderPreGatewayCreditInput
): number {
  const total = toNonNegativeAmount(input.total);
  const amountPaid = toNonNegativeAmount(input.amountPaid);
  const walletColumn = toNonNegativeAmount(input.walletAmountUsed);
  const walletLedger = toNonNegativeAmount(input.walletLedgerUsed);
  const savingsLedger = toNonNegativeAmount(input.savingsLedgerUsed);
  const reversalCompleted = input.walletReversalCompleted === true;

  const effectiveWallet = reversalCompleted
    ? walletLedger
    : Math.max(walletColumn, walletLedger);

  if (!isPreGatewayCreditStatus(input.paymentStatus)) {
    return Math.min(effectiveWallet + savingsLedger, total);
  }

  const effectiveAmountPaid = reversalCompleted ? 0 : amountPaid;
  return Math.min(
    Math.max(effectiveAmountPaid, effectiveWallet + savingsLedger, 0),
    total
  );
}

/**
 * Computes net remaining payable amount (`>= 0`, 2-decimal rounded) after
 * subtracting authoritative pre-gateway store credit.
 */
export function computeOrderNetPayable(
  input: OrderPreGatewayCreditInput
): number {
  const total = toNonNegativeAmount(input.total);
  const preGatewayPaid = computeOrderPreGatewayPaid(input);
  return Math.max(Number((total - preGatewayPaid).toFixed(2)), 0);
}
