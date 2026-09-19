import { z } from 'zod';

const unitReferenceSchema = z
  .object({
    orderItemId: z.uuid(),
    unitOrdinal: z.number().int().positive(),
  })
  .strict();

export const redvaultRefundRequestSchema = z
  .object({
    attemptId: z.uuid(),
    idempotencyKey: z.string().trim().min(1).max(200),
    merchantId: z.uuid(),
    type: z.enum(['full_capture', 'merchandise_units']),
    units: z.array(unitReferenceSchema).min(1).max(10_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.type === 'full_capture' && value.units !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'full capture refunds do not accept merchandise units',
        path: ['units'],
      });
    }
    if (value.type === 'merchandise_units' && value.units === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'merchandise refunds require persisted unit identities',
        path: ['units'],
      });
    }
  });

export type RedvaultRefundRequest = z.infer<typeof redvaultRefundRequestSchema>;
