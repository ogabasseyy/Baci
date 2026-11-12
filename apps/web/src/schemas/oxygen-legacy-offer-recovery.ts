import { z } from 'zod';
export const oxygenLegacyOfferRecoverySchema = z
  .object({
    workflowId: z.uuid(),
    version: z.number().int().nonnegative(),
    idempotencyKey: z.uuid(),
  })
  .strict();
