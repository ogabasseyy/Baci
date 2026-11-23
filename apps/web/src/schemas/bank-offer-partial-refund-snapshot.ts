import { z } from 'zod';

const kobo = z.number().int().nonnegative();
const decimalId = z.string().regex(/^[1-9][0-9]{0,19}$/);
const itemId = z.uuid().transform((value) => value.toLowerCase());

export const partialRefundSnapshotSchema = z.object({
  capture: z.object({
    reference: z.string().min(1),
    id: decimalId,
    domain: z.enum(['test', 'live']),
    amountKobo: kobo.positive(),
  }),
  merchandiseNetKobo: kobo.positive(),
  allocations: z
    .array(
      z.object({
        itemId,
        unitNetAmountsKobo: z.array(kobo).min(1),
      })
    )
    .min(1),
});

export type PartialRefundSnapshot = z.infer<typeof partialRefundSnapshotSchema>;
