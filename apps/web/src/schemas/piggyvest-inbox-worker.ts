import { z } from 'zod';

export const piggyvestInboxWorkerSchemas = {
  configuration: z
    .object({
      environment: z.literal('staging'),
      integrationId: z.uuid(),
      batchSize: z.number().int().min(1).max(100),
      leaseSeconds: z.number().int().min(1).max(300),
    })
    .strict(),
  claims: z
    .array(
      z
        .object({
          inbox_id: z.uuid(),
          claim_token: z.uuid(),
        })
        .strict()
    )
    .max(100)
    .refine(
      (rows) => new Set(rows.map((row) => row.inbox_id)).size === rows.length
    ),
  finish: z
    .array(z.object({ outcome: z.enum(['quarantined', 'stale']) }).strict())
    .length(1),
};
