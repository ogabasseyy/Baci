import { z } from 'zod';

export const mcpDeliveryFeeInfoInputSchema = z.object({
  state: z.string().min(2).max(50).describe('Nigerian delivery state'),
  city: z.string().min(2).max(100).optional().describe('Delivery city'),
  items: z
    .array(
      z.object({
        product_id: z
          .uuid()
          .describe('Exact Ogabassey product ID from catalog search'),
        quantity: z.number().int().min(1).max(10),
        variant_id: z
          .uuid()
          .optional()
          .describe(
            'Selected catalog variant ID when the product has variants'
          ),
        weight_kg: z
          .number()
          .positive()
          .max(100)
          .optional()
          .describe(
            'Use only a package weight explicitly supplied by the buyer when catalog weight is unavailable; never guess'
          ),
      })
    )
    .min(1)
    .max(5)
    .optional()
    .describe(
      'Products to ship. Ask the buyer which products and quantities if missing; never infer an existing cart.'
    ),
  delivery_preference: z.enum(['door', 'pickup_station']).optional(),
});
