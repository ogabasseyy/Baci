import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';

/**
 * Fail-closed backstop for callers that skip the invalid-amount
 * quarantine preflight: external legs must sum to a safe positive
 * refundable total with every leg finite and positive. Internal-only
 * orders carry no external legs — their cash-like legs wait for the
 * merchant through the manual deferral — so the empty set returns
 * quietly instead of throwing.
 */
export function assertExternalCancellationRefundableAmount(
  transactions: GatewayPaymentTransaction[]
): void {
  if (transactions.length === 0) return;
  const gatewayRefundAmount = transactions.reduce(
    (total, transaction) => total + (Number(transaction.amount) || 0),
    0
  );
  if (
    gatewayRefundAmount <= 0 ||
    !Number.isSafeInteger(Math.round(gatewayRefundAmount * 100)) ||
    transactions.some(
      (transaction) =>
        !Number.isFinite(Number(transaction.amount)) ||
        Number(transaction.amount) <= 0
    )
  ) {
    throw new Error('Completed payment transaction has no refundable amount');
  }
}
