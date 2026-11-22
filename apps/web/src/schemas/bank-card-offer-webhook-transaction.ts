import { z } from 'zod';
import { isMajorAmountRepresentable } from '@/lib/money/is-major-amount-representable';
import { bankCardOfferReferenceSchema } from './bank-card-offer-reference';

export const bankCardOfferWebhookTransactionSchema = z.object({
  id: z.uuid(),
  merchant_id: z.uuid(),
  order_id: z.uuid(),
  gateway: z.literal('paystack'),
  gateway_reference: bankCardOfferReferenceSchema,
  // The transaction table stores major units. Normalize PostgREST's
  // numeric or decimal-string projection to exactly representable kobo,
  // then return a major-unit amount for the shared order finalizer.
  amount: z
    .union([z.number(), z.string().regex(/^[0-9]+(?:\.[0-9]{1,2})?$/)])
    .transform(Number)
    .refine((amount) => amount > 0 && isMajorAmountRepresentable(amount, 'NGN'))
    .transform((amount) => Math.round(amount * 100) / 100),
  platform_fee: z.number().nonnegative().nullable(),
});
