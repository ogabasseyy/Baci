import { z } from 'zod';
export const repairPickupAttemptSchema = z.object({
  requestId: z.uuid(),
  expectedPickupFee: z.number().positive(),
  resumeToken: z.string().optional(),
});
