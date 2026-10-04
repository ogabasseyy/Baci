import { z } from 'zod';

// Persist only validated fallback fields; refreshed catalog data supplies current facts.
export const comparisonSnapshotSchema = z.object({
  id: z.union([z.string().trim().min(1), z.number().finite()]),
  name: z.string().trim().min(1),
  price: z.string(),
  image: z.string(),
  description: z.string(),
  slug: z.string().optional(),
  merchantId: z.string().optional(),
  rawPrice: z.number().finite().nonnegative().optional(),
  category: z.string().optional(),
  categorySlug: z.string().optional(),
  categories: z
    .object({
      id: z.string(),
      name: z.string(),
      slug: z.string().optional(),
    })
    .optional(),
});
