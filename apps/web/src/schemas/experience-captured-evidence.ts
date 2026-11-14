import { z } from 'zod';
export const experienceVerifierDigest = z.string().regex(/^[a-f0-9]{64}$/);
export const experienceCapturedEvidence = z.strictObject({
  buildId: z.uuid().optional(),
  buildDigest: experienceVerifierDigest.optional(),
  effectDigest: experienceVerifierDigest,
  artifactReceipt: experienceVerifierDigest,
  evidenceDigest: experienceVerifierDigest,
  routes: z.array(z.string().min(1).max(240)).min(1).max(128),
});
