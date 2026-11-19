import { z } from 'zod';

export const cartQuotaCounterSchema = z.object({
  count: z.number().int().positive().max(2_147_483_647),
  resetTime: z.number().int().positive().safe(),
});
