import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const experienceBuildVerifierReceipt = z.strictObject({
  merchantId: z.uuid(),
  jobId: z.uuid(),
  attemptNonce: z.uuid(),
  buildDigest: digest,
  receiptDigest: digest,
  hostOrigin: z.string().max(1000),
});

export const experienceBuildVerifierMessage = z.strictObject({
  version: z.literal(1),
  nonce: digest,
  expiresAt: z.number().int().safe(),
  accessToken: z
    .string()
    .min(1)
    .max(8192)
    .regex(/^[A-Za-z0-9_.-]+$/),
  ...experienceBuildVerifierReceipt.shape,
});
