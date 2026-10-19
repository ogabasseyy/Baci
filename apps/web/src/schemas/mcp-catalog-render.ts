import { z } from 'zod';
import { mcpCatalogOptionReferenceSchema } from './mcp-catalog-option-reference';

export const mcpCatalogRenderInputSchema = z.strictObject({
  products: z
    .array(
      z.strictObject({
        product_id: z.string().min(1).max(80),
        matched_option: mcpCatalogOptionReferenceSchema.optional(),
      })
    )
    .min(1)
    .max(20)
    .refine(
      (products) =>
        new Set(products.map(({ product_id }) => product_id)).size ===
        products.length,
      'Each product_id may appear only once per catalog render.'
    ),
});
