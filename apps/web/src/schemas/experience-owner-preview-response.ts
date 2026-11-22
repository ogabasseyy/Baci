import { z } from 'zod';
import { performancePublicBootstrap } from './experience-performance-worker';

export const ownerPreviewLaunchResponse = z.object({
  src: z.string().max(1000),
  bindingId: z.uuid(),
  merchantId: z.uuid(),
  buildDigest: z.string().regex(/^[a-f0-9]{64}$/),
  instanceId: z.uuid(),
  nonce: z.uuid(),
  expiresAt: z.number().int().safe(),
  canonicalBase: z.string().max(1000),
  routes: z
    .array(
      z.strictObject({
        path: z.string().max(240),
        view: z.enum(['home', 'collection', 'product', 'editorial']),
      })
    )
    .min(1)
    .max(64),
  bootstrap: performancePublicBootstrap,
});
