import { createHmac } from 'node:crypto';
import type { PaystackChargeSuccessEvent } from './build-synthetic-paystack-outcome';

/** The raw body and `x-paystack-signature` value for a webhook delivery. */
export function signPaystackWebhook(
  event: PaystackChargeSuccessEvent,
  secret: string
): { rawBody: string; signature: string } {
  const rawBody = JSON.stringify(event);
  return {
    rawBody,
    signature: createHmac('sha512', secret).update(rawBody).digest('hex'),
  };
}
