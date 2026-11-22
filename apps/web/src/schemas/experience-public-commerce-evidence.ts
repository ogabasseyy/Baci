import { z } from 'zod';

export const publicCommerceEvidenceIdentity = z.object({
  merchantId: z.uuid(),
  productId: z.uuid(),
  variantId: z.uuid().optional(),
});

export function publicCommerceEvidenceSchemas({
  merchantId,
  productId,
  variantId,
}: z.infer<typeof publicCommerceEvidenceIdentity>) {
  const line = z.object({
    item: z.object({
      productId: z.literal(productId),
      ...(variantId
        ? { variantId: z.literal(variantId) }
        : { variantId: z.undefined().optional() }),
    }),
    quantity: z.literal(1),
  });
  const snapshot = z.object({
    cartId: z.uuid(),
    merchantId: z.literal(merchantId),
    version: z.number().int().positive(),
    lines: z.array(line).length(1),
  });
  const checkoutSnapshot = z.object({
    cartId: z.uuid(),
    merchantId: z.literal(merchantId),
    cartVersion: z.number().int().positive(),
    checkoutSessionId: z.uuid(),
    lines: z
      .array(
        z.object({
          productId: z.literal(productId),
          variantId: variantId ? z.literal(variantId) : z.null().optional(),
          quantity: z.literal(1),
          available: z.literal(true),
        })
      )
      .length(1),
  });
  return {
    line,
    responseSchema: z.object({
      cart: snapshot.optional(),
      snapshot: checkoutSnapshot.optional(),
    }),
  };
}
