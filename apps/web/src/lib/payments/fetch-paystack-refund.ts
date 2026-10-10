import type { PaystackResult } from '@/lib/paystack';
import { paystackRequest } from '@/lib/paystack-request';

/** Read back the current provider state before changing a local refund. */
export function fetchRefund(
  id: number,
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
  if (!Number.isSafeInteger(id) || id <= 0) {
    return Promise.resolve({
      success: false,
      error: 'Invalid refund ID',
      code: 'VALIDATION_ERROR',
    });
  }
  return paystackRequest(`/refund/${id}`, { signal });
}
