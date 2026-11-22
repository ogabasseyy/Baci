import { z } from 'zod';

export const paystackTextIdPaymentIdentitySchema = z.object({
  currency: z.string().min(1),
  id: z.string().regex(/^[1-9][0-9]*$/),
  reference: z.string().min(1),
  status: z.string().min(1),
});
