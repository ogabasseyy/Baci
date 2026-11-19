import { z } from 'zod';

export const staleCheckoutCancellationResponseSchema = z.object({
  success: z.literal(true),
  cancelled: z.boolean(),
});
