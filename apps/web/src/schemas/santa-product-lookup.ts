import { z } from 'zod';

export const santaProductLookupSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

const santaLookupProductSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string(),
  description: z.string(),
  price: z.number().finite().nonnegative(),
  image: z.string(),
  imageLarge: z.string(),
  imageHint: z.string(),
  status: z.enum(['draft', 'active', 'archived']),
  merchant_id: z.string().min(1),
  stock: z.number().finite().nonnegative(),
  manage_stock: z.boolean(),
  brand: z.string(),
  sku: z.string(),
  gtin: z.string(),
  mpn: z.string(),
});

export const santaProductLookupResponseSchema = z.object({
  product: santaLookupProductSchema.nullable(),
});
