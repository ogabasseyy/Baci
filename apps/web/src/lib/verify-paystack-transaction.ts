import { z } from 'zod';
import { logger } from './logger';
import {
  type PaymentVerificationResponse,
  PaymentVerificationSchema,
  type PaystackResult,
} from './paystack';
import { paystackRequest } from './paystack-request';
import { selectPaystackRefundReference } from './select-paystack-refund-reference';

export type TextIdPaymentVerificationResponse = Omit<
  PaymentVerificationResponse,
  'id'
> & { id: string };

// Text-mode validation skips the nested customer object: the wire
// quoter quotes every "id" key (member order is not contractual, so
// a top-level-only rewrite is fragile), which would trip the
// customer.id numeric check with a warning on every call. The
// reconcile consumer only reads the top-level id, reference, amount,
// and currency.
const TextIdPaymentVerificationSchema = PaymentVerificationSchema.omit({
  customer: true,
}).extend({
  id: z.string().regex(/^[1-9][0-9]*$/),
});

/**
 * Verify a Paystack transaction
 *
 * Overload order is load-bearing: ReturnType resolves to the LAST
 * overload, and existing consumers type their mocks off it, so the
 * default numeric-ID variant stays last.
 */
export function verifyTransaction(
  reference: string,
  signal: AbortSignal | undefined,
  options: { textIds: true }
): Promise<PaystackResult<TextIdPaymentVerificationResponse>>;
export function verifyTransaction(
  reference: string,
  signal?: AbortSignal,
  options?: { textIds?: false }
): Promise<PaystackResult<PaymentVerificationResponse>>;
export async function verifyTransaction(
  reference: string,
  signal?: AbortSignal,
  options: { textIds?: boolean } = {}
): Promise<
  PaystackResult<
    PaymentVerificationResponse | TextIdPaymentVerificationResponse
  >
> {
  // Validate reference format to prevent SSRF attacks. Share the
  // webhook/recovery alphabet: dots and equals signs stay safe because the
  // reference is encoded into the request path below.
  if (selectPaystackRefundReference(reference, undefined) !== reference) {
    return {
      success: false,
      error: 'Invalid transaction reference format',
      code: 'VALIDATION_ERROR',
    };
  }

  // Opt-in decimal-text IDs for the refund reconcile identity check:
  // Paystack IDs are unsigned 64-bit, so a numeric parse would round
  // adjacent large IDs equal. Default callers keep numeric IDs.
  const quoteWirePaymentId = (raw: string): string =>
    raw.replace(/"id"\s*:\s*(\d+)/g, '"id":"$1"');
  const result = await paystackRequest<
    PaymentVerificationResponse | TextIdPaymentVerificationResponse
  >(`/transaction/verify/${encodeURIComponent(reference)}`, {
    signal,
    ...(options.textIds ? { preprocessResponseText: quoteWirePaymentId } : {}),
  });

  if (!result.success) {
    return result;
  }

  // Validate response
  const parsed = (
    options.textIds
      ? TextIdPaymentVerificationSchema
      : PaymentVerificationSchema
  ).safeParse(result.data);
  if (!parsed.success) {
    logger.warn({
      message: 'Payment verification response validation warning',
      issues: parsed.error.issues,
    });
  }

  return { success: true, data: result.data };
}
