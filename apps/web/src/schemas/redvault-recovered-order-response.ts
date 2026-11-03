import { z } from 'zod';

export const redvaultRecoveredOrderResponseSchema = z
  .object({
    order: z
      .object({
        id: z.string().min(1),
        tracking_token: z.string().min(1),
        currency: z
          .string()
          .refine((value) => value.trim().toUpperCase() === 'NGN'),
        total: z.number().finite(),
        order_number: z.string().optional().catch(undefined),
      })
      .passthrough(),
  })
  .passthrough();
