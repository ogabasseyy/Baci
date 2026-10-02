import { z } from 'zod';

export const orderRefundSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('retry') }).strict(),
  z
    .object({
      action: z.literal('manual'),
      amount: z
        .number()
        .finite()
        .positive()
        .refine(
          (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001,
          'Use at most two decimal places'
        ),
      refundedAt: z.iso
        .datetime({ offset: true })
        .refine(
          (value) => Date.parse(value) <= Date.now(),
          'Refund date cannot be in the future'
        ),
      method: z.enum(['paystack', 'bank_transfer', 'cash', 'other']),
      reference: z.string().trim().min(1).max(100),
      note: z.string().trim().max(500).optional(),
      confirmed: z.literal(true),
    })
    .strict(),
]);
