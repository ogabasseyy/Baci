import { z } from 'zod';

export const guestCartLineSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(10),
});
