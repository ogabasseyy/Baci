import { z } from 'zod';

const uuid = z.uuid();

export const prefundedCardWorkerSchemas = {
  scope: z.strictObject({
    environment: z.literal('staging'),
    integrationId: uuid,
    merchantId: uuid,
    treasuryBindingId: uuid,
    businessId: z.string().trim().min(1).max(512),
    expectedSystemId: z.string().regex(/^[0-9]{1,20}$/),
    batchSize: z.number().int().min(1).max(20).default(5),
  }),
  claims: z
    .array(
      z.strictObject({
        result: z
          .array(
            z.strictObject({
              operationId: uuid,
              token: uuid,
            })
          )
          .max(20),
      })
    )
    .length(1),
  acknowledgement: z.array(z.strictObject({ result: z.boolean() })).length(1),
};
