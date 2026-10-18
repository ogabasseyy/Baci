import { z } from 'zod';

export const mcpCatalogOptionReferenceSchema = z.strictObject({
  kind: z.enum(['base', 'variant', 'offer']),
  option_id: z.string().min(1).max(80).optional(),
  variantId: z.string().min(1).max(80).optional(),
  condition: z.string().min(1).max(50),
});
