import { z } from 'zod';

export const mcpMatchedOptionSchema = z.object({
  kind: z.enum(['base', 'variant', 'offer']),
  option_id: z.string().optional(),
  variantId: z.string().optional(),
  condition: z.string(),
  price: z.number().nonnegative(),
  attributes: z.record(z.string(), z.unknown()),
});
