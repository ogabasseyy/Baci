import { z } from 'zod';

export const giglTrackingTokenSchema = z.strictObject({
  token: z.string().min(1).max(8192),
  userChannelCode: z.string().min(1).max(256),
  customerType: z.number().finite(),
  expiresAt: z.number().int().positive(),
});

export const giglTrackingTokenCacheRecordSchema = z.strictObject({
  version: z.literal(1),
  salt: z.string().regex(/^[a-f0-9]{32}$/),
  iv: z.string().regex(/^[a-f0-9]{24}$/),
  tag: z.string().regex(/^[a-f0-9]{32}$/),
  ciphertext: z
    .string()
    .min(1)
    .max(100000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
