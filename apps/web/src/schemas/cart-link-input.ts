import { z } from 'zod';

// Input contract for prepare_storefront_cart_link (and its add_to_cart
// alias): a single shared Zod source for the runtime registration and the
// public server-card JSON, so the two cannot drift. Product IDs are opaque
// catalog strings (UUIDs today), not necessarily UUIDs, so length bounds
// apply instead of uuid().
export const cartLinkInputSchema = z.object({
  product_id: z
    .string()
    .min(1)
    .max(80)
    .describe('The product ID to add to cart'),
  quantity: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(1)
    .describe('Quantity to add'),
});
