import { z } from 'zod';
import { containsAsciiControl } from '@/lib/contains-ascii-control';
import { prefundedCardKnownDeadlineSchema } from './prefunded-card-known-deadline';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const kobo = z.number().int().positive().safe();
const email = z.email().max(254);
const consent = z.strictObject({
  version: z.literal('prefunded-first-card-v1'),
  oneTimeCharge: z.literal(true),
  saveCard: z.literal(true),
});
const scope = z.strictObject({
  deployment: z.literal('staging'),
  integrationId: uuid,
  merchantId: uuid,
  treasuryBindingId: uuid,
  businessId: z.string().trim().min(1).max(512),
  systemIdentifier: z.literal('7685292944002592802'),
  expiresAt: prefundedCardKnownDeadlineSchema,
});
const selection = z.strictObject({
  intentId: uuid,
  customerId: uuid,
  actorId: uuid,
  goalId: uuid,
});
const request = selection.omit({ intentId: true }).extend({
  amountKobo: kobo,
  idempotencyKey: uuid,
  consent,
});
const intent = scope
  .extend({
    ...selection.shape,
    amountKobo: kobo,
    idempotencyKey: uuid,
    consent,
    email,
    currency: z.literal('NGN'),
    reference: z
      .string()
      .max(64)
      .regex(/^pvb-first-[0-9a-f-]{36}$/),
    requestFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .refine((value) => value.reference === `pvb-first-${value.intentId}`, {
    message: 'Checkout reference mismatch',
  });
const session = z.strictObject({
  reference: z
    .string()
    .max(64)
    .regex(/^pvb-first-[0-9a-f-]{36}$/),
  authorizationUrl: z
    .string()
    .max(512)
    .regex(/^https:\/\/checkout\.paystack\.com\/[A-Za-z0-9]+$/),
});
const authorization = z.strictObject({
  authorizationCode: z
    .string()
    .max(512)
    .regex(/^AUTH_[A-Za-z0-9_]+$/),
  signature: z.string().min(1).max(512).regex(/^\S+$/),
  customerCode: z
    .string()
    .max(512)
    .regex(/^CUS_[A-Za-z0-9_]+$/),
  email,
  reusable: z.literal(true),
  brand: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine((brand) => !containsAsciiControl(brand)),
  last4: z.string().regex(/^\d{4}$/),
  expiryMonth: z.string().regex(/^(0?[1-9]|1[0-2])$/),
  expiryYear: z.string().regex(/^\d{4}$/),
});
const collection = z.strictObject({
  intentId: uuid,
  reference: z
    .string()
    .max(64)
    .regex(/^pvb-first-[0-9a-f-]{36}$/),
  providerTransactionId: z
    .string()
    .regex(/^[1-9][0-9]{0,19}$/)
    .refine(
      (value) =>
        /^[1-9][0-9]{0,19}$/.test(value) &&
        BigInt(value) <= 18_446_744_073_709_551_615n
    ),
  amountKobo: kobo,
  currency: z.literal('NGN'),
  domain: z.literal('test'),
  authorization,
});

export const prefundedCardCheckoutSchemas = {
  consent,
  scope,
  request,
  selection,
  customerRequest: request.omit({ customerId: true, actorId: true }),
  customerSelection: selection.omit({ customerId: true, actorId: true }),
  customerIdentity: selection.omit({ intentId: true }),
  intent,
  session,
  authorization,
  collection,
  providerSettings: scope.extend({
    paystackSecret: z.string().regex(/^sk_test_[A-Za-z0-9]+$/),
    callbackUrl: z.literal('https://staging.ogabassey.com/savings/card-return'),
  }),
};
