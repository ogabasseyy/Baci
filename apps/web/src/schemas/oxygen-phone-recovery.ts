import { z } from 'zod';
export const oxygenPhoneRecoverySchema = z
  .object({
    workflowId: z.uuid(),
    version: z.number().int().nonnegative(),
    idempotencyKey: z.uuid(),
  })
  .strict();
