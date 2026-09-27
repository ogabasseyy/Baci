import { z } from 'zod';

export const redvaultAvailabilityQuerySchema = z.object({
  merchant_id: z.string().uuid(),
});
