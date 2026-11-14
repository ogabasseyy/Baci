import { z } from 'zod';
export const experiencePublicRequestSchema = z.strictObject({
  buildDigest: z.string().regex(/^[a-f0-9]{64}$/),
  path: z.string().max(1024).default('/'),
});
export const experienceLaunchRenewalSchema = z.strictObject({
  buildDigest: z.string().regex(/^[a-f0-9]{64}$/),
  policyRevision: z.string().min(1).max(128),
  catalogRevision: z.string().min(1).max(128),
  expiresAt: z.number().int().positive(),
});

export const experiencePublicationStateSchema = z.strictObject({
  active: z.boolean(),
  status: z.enum(['active', 'unpublished', 'unavailable']).optional(),
  buildDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable()
    .optional(),
  publicationRevision: z.string().max(128).optional(),
  routeMapDigest: z.string().max(128).optional(),
  capabilityRevision: z.string().max(128).optional(),
  policyRevision: z.string().max(128),
  catalogRevision: z.string().max(128),
});
