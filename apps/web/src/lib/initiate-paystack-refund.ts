import { logger } from './logger';
import type { PaystackResult } from './paystack';
import { paystackRequest } from './paystack-request';
import { selectPaystackRefundReference } from './select-paystack-refund-reference';

/**
 * Initiate a refund for a Paystack transaction
 * @param transaction - Transaction reference or ID
 * @param amount - Amount to refund in kobo (optional, defaults to full amount)
 * @param reason - Reason for refund (optional)
 * @param timeoutMs - Abort the provider call after this long (optional).
 * An abort surfaces as NETWORK_ERROR, which callers already treat as
 * ambiguous provider state.
 */
export async function initiateRefund(
  transaction: string,
  amount?: number,
  reason?: string,
  timeoutMs?: number
): Promise<
  PaystackResult<{
    id: number;
    status: string;
    transaction: number | { id: number; reference: string };
  }>
> {
  // Share the webhook/recovery reference alphabet: Paystack references
  // may contain dots and equals signs, which must reach the provider.
  if (selectPaystackRefundReference(transaction, undefined) !== transaction) {
    return {
      success: false,
      error: 'Invalid transaction reference format',
      code: 'VALIDATION_ERROR',
    };
  }

  const payload: Record<string, unknown> = { transaction };
  if (amount !== undefined && amount > 0) {
    payload.amount = amount;
  }
  if (reason) {
    payload.customer_note = reason;
  }

  const result = await paystackRequest<{
    id: number;
    status: string;
    transaction: number | { id: number; reference: string };
  }>('/refund', {
    method: 'POST',
    body: JSON.stringify(payload),
    ...(timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? { signal: AbortSignal.timeout(timeoutMs) }
      : {}),
  });

  if (!result.success) {
    logger.error({
      message: 'Paystack refund failed',
      transaction,
      error: result.error,
    });
  } else {
    logger.info({
      message: 'Paystack refund initiated',
      transaction,
      refundId: result.data?.id,
      status: result.data?.status,
    });
  }

  return result;
}
