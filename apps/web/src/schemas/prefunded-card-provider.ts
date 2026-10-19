import { z } from 'zod';
import { piggyvestStagingConfigurationSchema } from './piggyvest-staging-configuration';

const identifier = z.uuid().transform((value) => value.toLowerCase());

export const prefundedCardProviderSchemas = {
  settings: z
    .strictObject({
      paystackSecret: z.string().regex(/^sk_test_[A-Za-z0-9]+$/),
      paystackTimeoutMs: z.number().int().positive().max(10_000).default(5_000),
      piggyvest: piggyvestStagingConfigurationSchema,
      scope: z.strictObject({
        integrationId: identifier,
        merchantId: identifier,
        treasuryBindingId: identifier,
        sourceWalletId: z.string().trim().min(1).max(512),
      }),
    })
    .superRefine((value, context) => {
      if (value.piggyvest.expectedCurrency !== 'NGN') {
        context.addIssue({ code: 'custom', message: 'Unsupported currency' });
      }
    }),
  savedMethod: z.strictObject({
    savedMethodId: identifier,
    merchantId: identifier,
    customerId: identifier,
    email: z.email(),
    authorizationCode: z.string().trim().min(1).max(512),
    paystackCustomerCode: z.string().trim().min(1).max(512),
    domain: z.literal('test'),
    reusable: z.boolean(),
    active: z.boolean(),
  }),
};
