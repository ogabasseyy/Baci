import { z } from 'zod';
export const experiencePublicOutputFile = z.strictObject({
  path: z.string().max(128),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  mime: z.enum(['text/javascript', 'text/css', 'image/png', 'font/woff2']),
  hex: z
    .string()
    .max(33554432)
    .regex(/^(?:[a-f0-9]{2})*$/),
});
export const experiencePublicPrerenderBinding = z.strictObject({
  merchantId: z.uuid(),
  buildId: z.uuid(),
  buildDigest: z.string().regex(/^[a-f0-9]{64}$/),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
