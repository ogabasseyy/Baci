import { z } from 'zod';
export const experienceCatalogSelection = z.strictObject({
  handle: z
    .string()
    .regex(/^[a-z0-9-]{1,240}$/)
    .optional(),
  productSlug: z
    .string()
    .regex(/^[a-z0-9-]{1,240}$/)
    .optional(),
  productId: z.uuid().optional(),
});
