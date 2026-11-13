import { z } from 'zod';

export const blackFridayResponseSchema = z.object({
  products: z.array(
    z.object({
      id: z.string(),
      slug: z.string().regex(/^[a-z0-9-]+$/i),
      name: z.string(),
      image: z.string(),
      price: z.string(),
      compareAtPrice: z.string().optional(),
    })
  ),
});
