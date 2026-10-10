import { z } from 'zod';

const variantIdSchema = z.uuid({
  error: 'variantId/variant_id must be a UUID',
});

const offerIdSchema = z.uuid({
  error: 'offerId must be a UUID',
});

const cartItemSchema = z
  .object({
    condition: z.string().optional(),
    id: z.string(),
    offerId: offerIdSchema.optional(),
    price: z.number(),
    variant_attributes: z.record(z.string(), z.string()).optional(),
    variant_id: variantIdSchema.optional(),
    variantAttributes: z.record(z.string(), z.string()).optional(),
    variantId: variantIdSchema.optional(),
  })
  .superRefine((item, ctx) => {
    if (
      item.variantId &&
      item.variant_id &&
      item.variantId !== item.variant_id
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'conflicting variantId and variant_id',
        path: ['variant_id'],
      });
    }
  });

export const cartValidateSchema = z.object({
  productIds: z.array(z.string()).max(50).optional(),
  cartItems: z.array(cartItemSchema).max(50).optional(),
});
