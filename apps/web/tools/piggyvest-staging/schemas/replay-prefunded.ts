import { z } from 'zod';

export const replayPrefundedSchemas = {
  enrollment: z.enum(['enrolled', 'legacy', 'deferred']),
  originalSignature: z
    .strictObject({
      receiptId: z.string().min(1),
      payloadSha256: z
        .string()
        .length(64)
        .regex(/^[a-f0-9]+$/),
      signature: z
        .string()
        .length(128)
        .regex(/^[a-f0-9]+$/i),
    })
    .nullable(),
  outcome: z.discriminatedUnion('outcome', [
    z.strictObject({
      outcome: z.literal('processed'),
      projection: z.enum(['applied', 'duplicate', 'not_applicable']),
    }),
    z.strictObject({
      outcome: z.literal('retry'),
      stage: z.enum(['evidence', 'projection']),
    }),
    z.strictObject({ outcome: z.literal('reconciliation_required') }),
    z.strictObject({ outcome: z.literal('rejected') }),
  ]),
};
