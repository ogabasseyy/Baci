import { z } from 'zod';

export const oxygenStorefrontAvailabilityQuery = z.object({
  merchantId: z.string().uuid(),
});
