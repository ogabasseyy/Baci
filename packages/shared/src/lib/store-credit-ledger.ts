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

/**
 * Returns true when an order payment_status represents an unsettled
 * pre-gateway state where `orders.amount_paid` records pre-gateway credit.
 */
export function isPreGatewayCreditStatus(status?: string | null): boolean {
  const normalized = (status ?? 'unpaid').trim().toLowerCase();
  return normalized === 'unpaid' || normalized === 'pending';
}

/**
 * Sums net completed wallet redemptions (`source_type = 'order_redemption'`,
 * `type = 'redemption'`, `status = 'completed'`) minus any `'order_reversal'`
 * rows for the order, clamped to `>= 0`.
 */
export function sumNetWalletLedgerCredit(rows: unknown): number {
  if (!Array.isArray(rows)) return 0;

  let redeemed = 0;
  let reversed = 0;

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as {
      amount?: unknown;
      source_type?: unknown;
      type?: unknown;
      status?: unknown;
    };
    const amount = toNonNegativeAmount(record.amount);
    if (amount <= 0) continue;

    if (
      record.source_type === 'order_redemption' &&
      record.type === 'redemption' &&
      record.status === 'completed'
    ) {
      redeemed += amount;
    } else if (record.source_type === 'order_reversal') {
      reversed += amount;
    }
  }

  return Math.max(Math.round((redeemed - reversed) * 100) / 100, 0);
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
