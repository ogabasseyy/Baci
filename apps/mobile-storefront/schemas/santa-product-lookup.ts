import { z } from 'zod';

const santaProductLookupResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number().finite().nonnegative(),
  max_discount_percentage: z.number().finite().nonnegative().nullish(),
  image: z.string().nullish(),
  manage_stock: z.boolean().nullish(),
  slug: z.string().nullish(),
  stock: z.number().finite().nonnegative().nullish(),
});

export const santaProductLookupResponseSchema = z.object({
  product: santaProductLookupResultSchema.nullable(),
});

export type SantaProductLookupResult = z.infer<
  typeof santaProductLookupResultSchema
>;
