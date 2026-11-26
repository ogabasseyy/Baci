import { z } from 'zod';

export const experienceCaptureVerifierSelection = z.strictObject({
  buildId: z.uuid(),
  routeId: z.string().min(1).max(240),
  idempotencyKey: z.uuid(),
});
export const experienceCaptureVerifierOutput = z.strictObject({
  evidenceId: z.uuid(),
  buildId: z.uuid(),
  buildDigest: z.string().regex(/^[a-f0-9]{64}$/),
  previewUrl: z.string().max(2000),
});

export const experienceCaptureVerifierMessage = z.strictObject({
  version: z.literal(1),
  nonce: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.number().int().safe(),
  accessToken: z
    .string()
    .min(1)
    .max(8192)
    .regex(/^[A-Za-z0-9_.-]+$/),
  merchantId: z.uuid(),
  ...experienceCaptureVerifierSelection.shape,
});
