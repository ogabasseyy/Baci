import { z } from 'zod';

function canonicalBase64(value: string, size?: number) {
  const decoded = Buffer.from(value, 'base64');
  return (
    decoded.toString('base64') === value &&
    (size === undefined || decoded.length === size)
  );
}

export const intakeSchema = z.strictObject({
  payloadSha256: z
    .string()
    .length(64)
    .regex(/^[a-f\d]{64}$/),
  ciphertext: z
    .string()
    .max(4 * Math.ceil((1024 * 1024) / 3))
    .refine((value) => canonicalBase64(value))
    .refine((value) => Buffer.from(value, 'base64').length <= 1024 * 1024),
  nonce: z
    .string()
    .length(16)
    .refine((value) => canonicalBase64(value, 12)),
  authTag: z
    .string()
    .length(24)
    .refine((value) => canonicalBase64(value, 16)),
  keyVersion: z.literal('staging-v1'),
});
