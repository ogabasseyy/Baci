import { z } from 'zod';
import { isMajorAmountRepresentable } from '@/lib/money/is-major-amount-representable';

const positiveSafeInteger = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const reference = z.string().regex(/^BCO-[a-f0-9]{32}$/);

const savedQuote = z.object({
  merchantId: z.uuid(),
  approvedTermsReference: z.string().min(1),
  endsAt: z.iso.datetime({ offset: true }),
  paymentPolicy: z.object({
    partnership: z.string().min(1),
    bankCode: z.enum(['035', '232']),
    issuerName: z.string().min(1),
    cardBrands: z
      .array(z.enum(['visa', 'mastercard', 'verve']))
      .min(1)
      .max(3),
  }),
  productSubtotalKobo: positiveSafeInteger,
  eligibleSubtotalKobo: positiveSafeInteger,
  discountKobo: positiveSafeInteger,
  allocations: z
    .array(
      z.object({
        itemId: z.uuid(),
        productId: z.uuid(),
        quantity: positiveSafeInteger,
        unitPriceKobo: z.number().int().nonnegative(),
        unitNetAmountsKobo: z.array(z.number().int().nonnegative()),
      })
    )
    .min(1),
});

const paymentContext = z.object({
  quote: savedQuote,
  amountKobo: positiveSafeInteger,
  customerEmail: z.email(),
});

export const bankCardOfferCheckoutContextSchema = paymentContext.extend({
  subaccount: z.string().regex(/^ACCT_[a-zA-Z0-9]+$/),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
});

export const bankCardOfferCheckoutUrlSchema = z
  .string()
  .max(2048)
  .regex(
    /^https:\/\/checkout[.]paystack[.]com\/[A-Za-z0-9._~%/-]+(?:\?[A-Za-z0-9._~%+&=;:@,/?-]+)?$/
  );

export const bankCardOfferWebhookTransactionSchema = z.object({
  id: z.uuid(),
  merchant_id: z.uuid(),
  order_id: z.uuid(),
  gateway: z.literal('paystack'),
  gateway_reference: reference,
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

export const bankCardOfferClaimSchema = z.object({
  claimed: z.boolean(),
  reference,
  checkoutUrl: bankCardOfferCheckoutUrlSchema.nullable(),
});

export const bankCardOfferVerificationContextSchema = paymentContext.extend({
  reference,
  acceptedFilterPolicyHash: z.string().regex(/^[0-9a-f]{64}$/),
  domain: z.enum(['test', 'live']),
  completedGatewayResponse: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional(),
});
