import { z } from 'zod';

// Paystack refund.* webhook payload, parsed before the handler touches the
// database. Field selection mirrors what the reconciler reads: the refund
// resource ID, its provider status, and the original payment reference in
// nested (transaction.reference) or flat (transaction_reference) form.
// Unknown provider fields pass through; wrong types fail closed. At least
// one usable identifier is required: an identifier-less event would
// otherwise be acknowledged without reconciling anything, silently dropping
// a malformed or changed provider delivery (held refunds have no polling
// fallback). A bare numeric transaction is not usable: the handler reads
// only the nested reference string.
// A reference counts as usable only in the shape the reference-path
// reconciler consumes; anything else is silently unusable downstream, so
// the schema rejects it rather than acknowledging a no-op delivery. The
// base fields stay plain strings so an ID-keyed event with a noisy
// reference still validates: the refund-ID path ignores the reference.
const USABLE_REFERENCE = /^[A-Za-z0-9_-]{1,100}$/;

export const paystackRefundEventSchema = z
  .object({
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
  })
  .superRefine((payload, ctx) => {
    const data = payload.data;
    const transaction = data?.transaction;
    const nestedReference =
      transaction !== null &&
      typeof transaction === 'object' &&
      !Array.isArray(transaction)
        ? (transaction as { reference?: unknown }).reference
        : undefined;
    const flatReference = data?.transaction_reference;
    const hasRefundId =
      typeof data?.id === 'number' &&
      Number.isSafeInteger(data.id) &&
      data.id > 0;
    const hasReference =
      (typeof nestedReference === 'string' &&
        USABLE_REFERENCE.test(nestedReference)) ||
      (typeof flatReference === 'string' &&
        USABLE_REFERENCE.test(flatReference));
    if (!hasRefundId && !hasReference) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Refund event carries no usable identifier: expected a positive data.id or a nested/flat transaction reference',
        path: ['data'],
      });
    }
  });

export type PaystackRefundEvent = z.infer<typeof paystackRefundEventSchema>;
