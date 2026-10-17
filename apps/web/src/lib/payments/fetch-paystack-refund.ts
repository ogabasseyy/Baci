import type { PaystackResult } from '@/lib/paystack';
import { paystackRequest } from '@/lib/paystack-request';

/**
 * Read back the current provider state before changing a local refund.
 * The id travels as validated decimal text: stamps persist text (a
 * >2^53 id would not survive a number round-trip), while older
 * callers pass safe numbers. The response itself still parses
 * through the shared JSON reader, so callers compare ids as text.
 */
export function fetchRefund(
  id: number | string,
  signal?: AbortSignal
): Promise<
  PaystackResult<{
    id: number;
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
  return paystackRequest(`/refund/${idText}`, { signal });
}
