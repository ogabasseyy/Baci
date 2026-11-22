import { z } from 'zod';

export const settledDeliverySchema = z.object({
  service: z.string().min(1),
  delivery_minor: z.number().int().positive(),
});
