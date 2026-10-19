import type { PaystackResult } from '@/lib/paystack';
import { paystackRequest } from '@/lib/paystack-request';

/**
 * Read back the current provider state before changing a local refund.
 * The refund id travels as validated decimal text both ways: stamps
 * persist text (a >2^53 id would not survive a number round-trip),
 * while older callers pass safe numbers, and the response id quotes
 * off the wire text before parsing like the list path. The payment
 * transaction id quotes the same way: Paystack IDs are unsigned
 * 64-bit, so a numeric parse would round adjacent large IDs equal
 * before the reconcile identity check compares them.
 */
export function fetchRefund(
  id: number | string,
  signal?: AbortSignal
): Promise<
  PaystackResult<{
    id: string;
    transaction: string;
    amount: number;
    currency: string;
    status: string;
  }>
> {
  const idText =
    typeof id === 'string' && /^[1-9][0-9]*$/.test(id)
      ? id
      : typeof id === 'number' && Number.isSafeInteger(id) && id > 0
        ? String(id)
        : null;
  if (idText === null) {
    return Promise.resolve({
      success: false,
      error: 'Invalid refund ID',
      code: 'VALIDATION_ERROR',
    });
  }
  // Mirror the list path: quote both the row id and the payment
  // transaction pointer, since both are unsigned 64-bit identities.
  const quoteWireRefundIds = (raw: string): string =>
    raw
      .replace(/"transaction"\s*:\s*(\d+)/g, '"transaction":"$1"')
      .replace(/"id"\s*:\s*(\d+)/g, '"id":"$1"');
  return paystackRequest(`/refund/${idText}`, {
    signal,
    preprocessResponseText: quoteWireRefundIds,
  });
}
