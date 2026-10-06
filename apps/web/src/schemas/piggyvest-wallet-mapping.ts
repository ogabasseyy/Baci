import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

export const piggyvestWalletMappingSchemas = {
  configuration: z
    .object({
      environment: z.literal('staging'),
      integrationId: z.uuid(),
      expectedMerchantId: z.uuid(),
    })
    .strict(),
  input: z
    .object({
      providerWalletId: piggyvestProviderIdSchema,
      providerCustomerId: piggyvestProviderIdSchema,
    })
    .strict(),
  response: z
    .array(
      z
        .object({
          merchant_id: z.uuid(),
          customer_id: z.uuid(),
          goal_id: z.uuid(),
          restriction_status: z.enum(['ready', 'restricted']),
        })
        .strict()
    )
    .max(1),
  recordInput: z
    .object({
      providerWalletId: piggyvestProviderIdSchema,
      providerCustomerId: piggyvestProviderIdSchema,
      merchantId: z.uuid(),
      customerId: z.uuid(),
      goalId: z.uuid(),
    })
    .strict(),
  recordResponse: z
    .array(
      z
        .object({
          recorded: z.boolean(),
        })
        .strict()
    )
    .length(1),
};
