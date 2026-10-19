import { z } from 'zod';
import { prefundedCardProviderSchemas } from './prefunded-card-provider';

const identifier = z.uuid().transform((value) => value.toLowerCase());
const identity = z.strictObject({
  savedMethodId: identifier,
  merchantId: identifier,
  customerId: identifier,
});
const authorizationCode = z
  .string()
  .max(512)
  .regex(/^AUTH_[A-Za-z0-9_]+$/);
const signature = z.string().min(1).max(512).regex(/^\S+$/);
const reference = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9.=-]+$/);
const providerId = z
  .union([
    z.number().int().positive().safe().transform(String),
    z.string().regex(/^[1-9][0-9]{0,19}$/),
  ])
  .refine((value) => BigInt(value) <= 18_446_744_073_709_551_615n);

export const prefundedCardAuthorizationResolverSchemas = {
  identity,
  scope: z.strictObject({
    treasuryBindingId: identifier,
    integrationId: identifier,
    merchantId: identifier,
    systemIdentifier: z.string().regex(/^[0-9]{1,20}$/),
  }),
  provision: identity.extend({ transactionId: identifier }),
  verification: z.strictObject({
    paystackSecret: z.string().regex(/^sk_test_[A-Za-z0-9]+$/),
  }),
  candidateRows: z
    .array(
      z.strictObject({
        result: identity.extend({
          transactionId: identifier,
          email: z.email(),
          authorizationCode,
          signature,
          reference,
          amountKobo: z.number().int().positive().safe(),
          merchantSlug: z.string().min(1).max(255),
        }),
      })
    )
    .length(1),
  verifiedReceipt: z.object({
    status: z.literal(true),
    data: z.object({
      id: providerId,
      status: z.literal('success'),
      domain: z.literal('test'),
      channel: z.literal('card'),
      reference,
      amount: z.number().int().positive().safe(),
      currency: z.literal('NGN'),
      customer: z.object({
        email: z.email(),
        customer_code: z
          .string()
          .max(512)
          .regex(/^CUS_[A-Za-z0-9_]+$/),
      }),
      authorization: z.object({
        authorization_code: authorizationCode,
        signature,
        reusable: z.literal(true),
        channel: z.literal('card'),
      }),
      metadata: z.object({
        customer_id: identifier,
        merchant_slug: z.string().min(1).max(255),
        transaction_type: z.literal('savings_authorization'),
      }),
    }),
  }),
  readRows: z
    .array(
      z.strictObject({
        result: prefundedCardProviderSchemas.savedMethod.extend({
          authorizationCode,
          paystackCustomerCode: z
            .string()
            .max(512)
            .regex(/^CUS_[A-Za-z0-9_]+$/),
        }),
      })
    )
    .length(1),
  provisionRows: z
    .array(
      z.strictObject({
        result: z.strictObject({
          savedMethodId: identifier,
          transactionId: identifier,
          outcome: z.enum(['provisioned', 'duplicate']),
        }),
      })
    )
    .length(1),
};
