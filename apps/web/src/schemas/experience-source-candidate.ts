import { z } from 'zod';
import { experienceDigest } from './experience-upload';
export const experienceSourceCandidateInput = z.strictObject({
  artifactId: z.uuid(),
  baseDigest: experienceDigest,
  expectedVersion: z.number().int().nonnegative(),
  idempotencyKey: z.uuid(),
});
export const experienceSourceCandidateResult = z.strictObject({
  artifactId: z.uuid(),
  version: z.number().int().nonnegative(),
  conflict: z.boolean(),
});
