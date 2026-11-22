import { z } from 'zod';

const itemId = z.uuid().transform((value) => value.toLowerCase());
const decimalId = z.string().regex(/^[1-9][0-9]{0,19}$/);
const units = z
  .array(
    z.strictObject({
      itemId,
      unitNumber: z.number().int().positive(),
    })
  )
  .min(1);

export const partialRefundManifestSchema = z.strictObject({
  units,
  previousRefunds: z.array(z.strictObject({ refundId: decimalId, units })),
});

export const partialRefundCliArgsSchema = z.tuple([
  z.uuid(),
  z.uuid(),
  z.string().min(1),
]);
export const partialRefundDatabaseUrlSchema = z.url({
  protocol: /^postgres(?:ql)?$/,
});
export type PartialRefundManifest = z.infer<typeof partialRefundManifestSchema>;
