import { z } from 'zod';

// Paystack refund.* webhook payload, parsed before the handler touches the
// database. Field selection mirrors what the reconciler reads: the refund
// resource ID, its provider status, and the original payment reference in
// nested (transaction.reference) or flat (transaction_reference) form.
// Unknown provider fields pass through; wrong types fail closed.
export const paystackRefundEventSchema = z.object({
  data: z
    .object({
      id: z.number().int().optional(),
      status: z.string().optional(),
      transaction: z
        .union([
          z.number().int(),
          z.object({ reference: z.string().optional() }).passthrough(),
        ])
        .optional(),
      transaction_reference: z.string().optional(),
    })
    .passthrough()
    .optional(),
  event: z.string().startsWith('refund.'),
});

export type PaystackRefundEvent = z.infer<typeof paystackRefundEventSchema>;
