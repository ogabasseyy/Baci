import { z } from 'zod';

export const mcpMatchedOptionSchema = z.object({
  kind: z.enum(['base', 'variant', 'offer']),
  option_id: z.string().optional(),
  variantId: z.string().optional(),
  condition: z.string(),
  price: z.number().nonnegative(),
  attributes: z.record(z.string(), z.unknown()),
});

export const mcpCatalogOptionReferenceSchema = z.strictObject({
  kind: z.enum(['base', 'variant', 'offer']),
  option_id: z.string().min(1).max(80).optional(),
  variantId: z.string().min(1).max(80).optional(),
  condition: z.string().min(1).max(50),
});
