import { z } from 'zod';
export const oxygenAddressRecoverySchema = z
  .object({
    workflowId: z.uuid(),
    version: z.number().int().nonnegative(),
    idempotencyKey: z.uuid(),
    bookingReference: z.uuid(),
  })
  .strict();
