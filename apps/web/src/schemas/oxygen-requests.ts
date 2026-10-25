import { z } from 'zod';

export const oxygenAttemptRequestSchema = z.object({
  orderId: z.uuid(),
});

export const oxygenAvailabilityQuerySchema = z.object({
  orderId: z.uuid(),
});

export type OxygenAttemptRequest = z.infer<typeof oxygenAttemptRequestSchema>;
export type OxygenAvailabilityQuery = z.infer<
  typeof oxygenAvailabilityQuerySchema
>;
