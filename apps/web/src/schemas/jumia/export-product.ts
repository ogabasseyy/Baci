import { z } from 'zod';
import { jumiaExportProductVariationSchema } from './export-product-variation';

export const jumiaExportProductSchema = z.object({
  integrationId: z.uuid(),
  merchantId: z.uuid().optional(),
  productId: z.uuid(),
  name: z.string().trim().min(1),
  brand: z.object({
    code: z.number().finite().positive(),
    name: z.string().trim().min(1),
  }),
  category: z.object({ code: z.number().finite().positive() }),
  description: z.string().optional(),
  images: z
    .array(z.object({ url: z.url(), primary: z.boolean().optional() }))
    .optional(),
  variations: z.array(jumiaExportProductVariationSchema).min(1),
});

export type JumiaExportProduct = z.infer<typeof jumiaExportProductSchema>;
