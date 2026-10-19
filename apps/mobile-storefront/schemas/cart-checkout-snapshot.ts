import { z } from 'zod';

const minor = z.number().int().nonnegative();
export const nativeCheckoutSnapshotSchema = z.object({
  checkoutSessionId: z.uuid(),
  generation: z.number().int().positive(),
  cartVersion: z.number().int().positive(),
  cartId: z.uuid(),
  merchantId: z.uuid(),
  lines: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        productId: z.uuid(),
        variantId: z.uuid().nullable(),
        condition: z.string().nullable(),
        options: z.record(z.string(), z.string()),
        quantity: z.number().int().min(1).max(10),
        negotiatedUnitPriceMinor: minor.nullable(),
        negotiationStatus: z.string().nullable(),
        negotiationInvalidated: z.boolean(),
        voucherToken: z.string().nullable(),
        voucherAwardId: z.string().nullable(),
        hasAssurance: z.boolean(),
        assuranceRate: z.number().nonnegative().nullable(),
        lastUnitPriceMinor: minor.nullable(),
        validatedUnitPriceMinor: minor,
        effectiveUnitPriceMinor: minor,
        priceChanged: z.boolean(),
        available: z.boolean(),
        unavailableReason: z
          .enum(['offer_invalid', 'out_of_stock', 'insufficient_stock'])
          .nullable(),
        stockQty: z.number().int().nonnegative(),
        manageStock: z.boolean(),
      })
    )
    .max(20),
  estimates: z.object({
    subtotalMinor: minor,
    currency: z.string().regex(/^[A-Z]{3}$/),
    lineCount: z.number().int().nonnegative(),
    unavailableCount: z.number().int().nonnegative(),
  }),
});
export type NativeCheckoutSnapshot = z.infer<
  typeof nativeCheckoutSnapshotSchema
>;
