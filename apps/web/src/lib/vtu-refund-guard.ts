/**
 * Fail-closed guard for VTU refunds that could not be confirmed.
 *
 * When a vend fails after the wallet was debited and the reversal RPC
 * fails, returning `failed` would look terminal to clients: they rotate
 * the idempotency key and the retry mints a fresh debit while the
 * original charge stands unreversed. Throwing `RetryableVtuError`
 * instead (routes map it to 5xx) makes clients keep the key, so the
 * retry dedupes onto the same row and re-attempts the refund.
 *
 * Extracted from vtu-fulfillment.ts per the Boy Scout Rule — that
 * module is over the 300-line budget, so touched logic lives here.
 */

/** Minimal row shape the guard needs (structural; no import cycle). */
export interface VtuRefundGuardRow {
  amount: number;
  customer_id: string | null;
  id: string;
  source: string | null;
}

export interface RetryableVtuErrorContext {
  failedMessage?: string;
  failedMetadata?: Record<string, unknown>;
  refundedAmount?: number;
  transactionId: string;
}

export class RetryableVtuError extends Error {
  context: RetryableVtuErrorContext;

  constructor(message: string, context: RetryableVtuErrorContext) {
    super(message);
    Object.setPrototypeOf(this, RetryableVtuError.prototype);
    this.name = 'RetryableVtuError';
    this.context = context;
  }
}

export function requiresVtuCustomerWalletRefund(
  row: VtuRefundGuardRow
): boolean {
  return Boolean(
    row.customer_id && row.source === 'checkout' && Number(row.amount) > 0
  );
}

/**
 * Throws `RetryableVtuError` when a customer wallet refund is required
 * but was not confirmed. No-op otherwise. Each call site keeps its own
 * message so server logs still identify which failure path threw.
 */
export function throwIfVtuRefundUnconfirmed({
  failedMessage,
  failedMetadata,
  message,
  refundIssued,
  refundedAmount,
  row,
}: {
  failedMessage?: string;
  failedMetadata?: Record<string, unknown>;
  message: string;
  refundIssued: boolean;
  refundedAmount: number;
  row: VtuRefundGuardRow;
}): void {
  if (requiresVtuCustomerWalletRefund(row) && !refundIssued) {
    throw new RetryableVtuError(message, {
      failedMessage,
      failedMetadata,
      refundedAmount,
      transactionId: row.id,
    });
  }
}
