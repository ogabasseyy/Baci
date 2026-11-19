import { z } from 'zod';
import { experienceCapabilitySchema } from './experience-manifest';
export const publishedExperienceSchema = z.strictObject({
  merchantId: z.uuid(),
  hostOrigin: z.string().url().nullable().optional(),
  buildDigest: z.string().regex(/^[a-f0-9]{64}$/),
  version: z.number().int().min(1),
  policyRevision: z.string().min(1).max(128),
  assetsDigest: z.string().regex(/^[a-f0-9]{64}$/),
  routes: z
    .array(
      z.strictObject({
        path: z.string().max(240),
        view: z.enum(['home', 'collection', 'product', 'editorial']),
      })
    )
    .max(64),
  assets: z
    .array(
      z.strictObject({
        assetId: z.string().regex(/^[a-z0-9-]{1,80}$/),
        alt: z.string().max(500),
      })
    )
    .max(32)
    .default([]),
  capabilities: z.array(experienceCapabilitySchema).max(6),
});
