import { z } from 'zod';
import { builderRevisionSchema } from './builder-mcp-primitives';
import { portableHomeSchema } from './portable-storefront';
export const builderEditLeaseSchema = z
  .object({
    operationId: z.uuid(),
    connectionId: z.uuid(),
    grantVersion: z.number().int().positive().safe(),
    sourceVersion: builderRevisionSchema,
    leaseId: z.uuid(),
    leaseExpiresAt: z.iso.datetime({ offset: true }),
    attempt: z.number().int().min(1).max(3),
    instructions: z.string().trim().min(1).max(4000),
    sourceConfig: z.unknown(),
  })
  .strict();
export type EditLease = z.infer<typeof builderEditLeaseSchema>;

export const builderReadyEditSchema = z
  .object({
    sourceConfig: portableHomeSchema,
    candidate: portableHomeSchema,
    candidateDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
