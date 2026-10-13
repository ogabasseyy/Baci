import { z } from 'zod';

export const checkoutShippingRecoverySchema = z.object({
  previewId: z.string().nullable(),
  quote: z.object({
    id: z.string(),
    price: z.number().nonnegative(),
    displayName: z.string(),
    estimatedDays: z.number(),
    expiresAt: z.string(),
  }),
  paidShippingFee: z.number().nonnegative(),
  canConfirm: z.boolean(),
  error: z.string().optional(),
});
