import { z } from 'zod';

export const chatwootCartReviewSnapshotSchema = z
  .object({
    cartVersion: z.number().int().nonnegative().safe(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    estimatedTotals: z.boolean(),
    items: z
      .array(
        z
          .object({
            lineId: z.string().min(1).max(128),
            name: z.string().min(1).max(120),
            productId: z.string().min(1).max(128),
            variantId: z.string().max(128).nullable(),
            condition: z.string().max(32).nullable(),
            quantity: z.number().int().min(1).max(1000).safe(),
            unitPriceMinor: z.number().int().nonnegative().safe(),
            lineTotalMinor: z.number().int().nonnegative().safe(),
          })
          .strict()
      )
      .max(20),
    itemsSubtotalMinor: z.number().int().nonnegative().safe(),
  })
  .strict();
