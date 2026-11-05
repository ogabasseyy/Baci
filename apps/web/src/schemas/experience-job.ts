import { z } from 'zod';
export const experienceBuildInput = z.strictObject({
  artifactId: z.uuid(),
  idempotencyKey: z.uuid(),
});
export const experienceFinalizeInput = z.strictObject({
  jobId: z.uuid(),
  idempotencyKey: z.uuid(),
});

export const experienceFinalizedBuildRow = z.strictObject({
  id: z.string().min(1).max(100),
  build_digest: z.string().regex(/^[a-f0-9]{64}$/),
  host_origin: z.string().url(),
});
