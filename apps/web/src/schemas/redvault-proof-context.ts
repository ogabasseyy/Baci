import { z } from 'zod';

const kobo = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const group = z
  .object({
    condition: z.string().nullable(),
    discountKobo: kobo,
    key: z.string().min(1),
    lineSubtotalKobo: kobo,
    members: z
      .array(
        z
          .object({
            allocationKobo: kobo,
            lineId: z.number().int().positive(),
            orderItemId: z.uuid(),
            quantity: z.number().int().positive().max(10_000),
          })
          .strict()
      )
      .min(1)
      .max(10_000),
    productId: z.uuid(),
    taxInclusive: z.literal(false),
    unitPriceKobo: kobo,
    variantAttributes: z.record(z.string(), z.string()),
    variantId: z.uuid().nullable(),
    vatCategoryCode: z.string().min(1),
    vatRateBp: kobo,
  })
  .strict();

export const redvaultProofContextSchema = z
  .object({
    applicationId: z.uuid(),
    discountKobo: kobo.positive(),
    eligibleSubtotalKobo: kobo.positive(),
    productSubtotalKobo: kobo.positive(),
    groups: z.array(group).min(1).max(10_000),
    taxBasis: z.literal('exclusive'),
  })
  .strict();
