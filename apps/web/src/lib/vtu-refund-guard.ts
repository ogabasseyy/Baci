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
import {
  VTU_REFUND_SKIPPED_KEY,
  VTU_REFUND_SKIPPED_NO_CHARGE,
  VTU_REFUND_SKIPPED_NO_COLLECTION,
} from '@/lib/vtu-refund-collection-evidence';

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

/**
 * Refund confirmation for legacy card-only rows: skips the throw
 * when the row was deliberately skipped — no collection evidence
 * (those rows never collected) or no charge (the wallet-race arm
 * charged nothing, Codex R116 P2) — so there is nothing to
 * confirm. Delegates to `throwIfVtuRefundUnconfirmed` otherwise.
 *
 * Extracted from vtu-fulfillment.ts per the 300-line Boy Scout Rule
 * (Codex R81 P1).
 */
export function throwUnlessRefundSkippedWithoutCollection({
  failedMessage,
  failedMetadata,
  message,
  refundIssued,
  refundedAmount,
  refundMetadata,
  row,
}: {
  failedMessage?: string;
  failedMetadata: Record<string, unknown>;
  message: string;
  refundIssued: boolean;
  refundedAmount: number;
  refundMetadata: Record<string, unknown>;
  row: VtuRefundGuardRow;
}): void {
  if (
    refundMetadata[VTU_REFUND_SKIPPED_KEY] !==
      VTU_REFUND_SKIPPED_NO_COLLECTION &&
    refundMetadata[VTU_REFUND_SKIPPED_KEY] !== VTU_REFUND_SKIPPED_NO_CHARGE
  ) {
    throwIfVtuRefundUnconfirmed({
      failedMessage,
      failedMetadata,
      message,
      refundIssued,
      refundedAmount,
      row,
    });
  }
}
