import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

export const piggyvestScopedWalletMappingSchemas = {
  configuration: z
    .object({
      environment: z.literal('staging'),
      expectedMerchantId: z.uuid(),
      integrationId: z.uuid(),
    })
    .strict(),
  scope: z
    .object({
      customerId: z.uuid(),
      goalId: z.uuid(),
      merchantId: z.uuid(),
    })
    .strict(),
  response: z
    .array(
      z
        .object({
          provider_customer_id: piggyvestProviderIdSchema,
          provider_wallet_id: piggyvestProviderIdSchema,
        })
        .strict()
    )
    .max(1),
};
