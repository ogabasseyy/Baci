import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const publicFrameBinding = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  buildDigest: digest,
  canonicalBase: z.string(),
  scriptDigest: digest,
  styleDigest: digest,
});

export const publicOutputBinding = publicFrameBinding.extend({
  assets: z.record(z.string().regex(/^[a-z0-9-]{1,80}$/), digest),
});
