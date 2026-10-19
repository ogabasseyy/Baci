import { z } from 'zod';

export const mcpCatalogOptionReferenceSchema = z.strictObject({
  kind: z.enum(['base', 'variant', 'offer']),
  option_id: z.string().min(1).max(80).optional(),
  variantId: z.string().min(1).max(80).optional(),
  condition: z.string().min(1).max(50),
  // search_products includes these display facts in matched_option. Accept
  // that exact object for handoff compatibility; the renderer ignores them
  // and reloads authoritative values by product and option ID.
  price: z.number().nonnegative().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});
