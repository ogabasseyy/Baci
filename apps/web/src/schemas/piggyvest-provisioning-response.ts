import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

export const piggyvestProvisioningResponseSchemas = {
  create_customer: z.object({
    status: z.literal(true),
    data: z.object({
      customer_id: piggyvestProviderIdSchema,
      wallet_id: piggyvestProviderIdSchema,
      new_customer: z.boolean(),
    }),
  }),
  create_plan_wallet: z.object({
    status: z.literal(true),
    data: z.object({
      id: piggyvestProviderIdSchema,
      interest_enabled: z.boolean().optional(),
    }),
  }),
};
