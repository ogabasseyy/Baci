import { z } from 'zod';

export const jumiaExportProductVariationSchema = z.object({
  sellerSku: z.string().trim().min(1),
  price: z.number().positive(),
  currency: z.string().default('NGN'),
  stock: z.int().min(0).optional(),
  attributes: z
    .array(z.object({ id: z.string(), value: z.string() }))
    .optional(),
});

export type JumiaExportProductVariation = z.infer<
  typeof jumiaExportProductVariationSchema
>;
