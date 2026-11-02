import { z } from 'zod';

export const giglTrackingTokenSchema = z.strictObject({
  token: z.string().min(1).max(8192),
  userChannelCode: z.string().min(1).max(256),
  customerType: z.number().finite(),
  expiresAt: z.number().int().positive(),
});

export const giglTrackingTokenCacheRecordSchema = z.strictObject({
  fingerprint: z.string().length(64),
  token: giglTrackingTokenSchema,
});
