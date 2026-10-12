import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const project = z.string().trim().min(1).max(128);

export const piggyvestCustomerPolicyContextSchemas = {
  configuration: z
    .strictObject({
      environment: z.literal('staging'),
      transport: z.literal('local_test'),
      integrationId: uuid,
      expectedBusinessId: piggyvestProviderIdSchema,
      merchantId: uuid,
      allowlistedMerchantIds: z.array(uuid).min(1).max(20),
      allowlistedCustomerIds: z.array(uuid).min(1).max(20),
      expectedProjectId: project,
      actualProjectId: project,
    })
    .refine(
      (config) =>
        config.expectedProjectId === config.actualProjectId &&
        config.allowlistedMerchantIds.includes(config.merchantId)
    ),
  input: z.strictObject({ goalId: uuid }),
  actor: z.object({ id: uuid }),
  merchant: z.strictObject({ id: uuid }),
  customer: z.strictObject({ id: uuid, merchant_id: uuid, user_id: uuid }),
  goal: z.strictObject({ id: uuid, merchant_id: uuid, customer_id: uuid }),
};
