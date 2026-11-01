import { z } from 'zod';

export const oxygenPlanAcceptanceInputSchema = z
  .object({
    workflowId: z.uuid(),
    bookingReference: z.uuid(),
    version: z.number().int().nonnegative(),
  })
  .strict();

export const oxygenPlanAcceptanceResultSchema = z.object({
  bookingReference: z.uuid(),
  version: z.number().int().nonnegative(),
});
