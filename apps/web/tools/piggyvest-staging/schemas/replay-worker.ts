import { z } from 'zod';

export const replayWorkerSchemas = {
  configuration: z.object({
    environment: z.literal('staging'),
    batchSize: z.int().min(1).max(100),
  }),
  mapping: z.discriminatedUnion('status', [
    z.strictObject({
      status: z.literal('matched'),
      mapping: z.strictObject({
        merchantId: z.string().min(1),
        customerId: z.string().min(1),
        providerCustomerId: z.string().min(1),
        pvbWallet: z.string().min(1),
      }),
    }),
    z.strictObject({ status: z.literal('unmapped') }),
    z.strictObject({ status: z.literal('ambiguous') }),
    z.strictObject({ status: z.literal('storage-error') }),
  ]),
};
