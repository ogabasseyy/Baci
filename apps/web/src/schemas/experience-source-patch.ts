import { z } from 'zod';
import { experienceDigest, experienceSourcePath } from './experience-upload';
export const experienceSourcePatch = z.strictObject({
  baseDigest: experienceDigest,
  expectedVersion: z.number().int().min(0),
  files: z
    .array(z.strictObject({ path: experienceSourcePath, content: z.string() }))
    .min(1)
    .max(128),
  idempotencyKey: z.uuid(),
});
