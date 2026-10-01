import { z } from 'zod';

export const adminGenerateProductImagesQuerySchema = z.object({
  parent_product_id: z.uuid().optional(),
});
