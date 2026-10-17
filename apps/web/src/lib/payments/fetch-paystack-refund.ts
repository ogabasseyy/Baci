import type { PaystackResult } from '@/lib/paystack';
import { paystackRequest } from '@/lib/paystack-request';

/**
 * Read back the current provider state before changing a local refund.
 * The refund id travels as validated decimal text both ways: stamps
 * persist text (a >2^53 id would not survive a number round-trip),
 * while older callers pass safe numbers, and the response id quotes
 * off the wire text before parsing like the list path. The payment
 * transaction id keeps the shared reader like the verify path.
 */
export function fetchRefund(
  id: number | string,
  signal?: AbortSignal
): Promise<
  PaystackResult<{
    id: string;
    transaction: number;
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
  const quoteWireRefundIds = (raw: string): string =>
    raw.replace(/"id"\s*:\s*(\d+)/g, '"id":"$1"');
  return paystackRequest(`/refund/${idText}`, {
    signal,
    preprocessResponseText: quoteWireRefundIds,
  });
}
