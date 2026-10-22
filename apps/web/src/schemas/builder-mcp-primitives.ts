import { z } from 'zod';
export const builderIdSchema = z.uuid();
export const builderRevisionSchema = z.string().min(1).max(256);
export const builderHomePagesSchema = z.tuple([z.literal('home')]);
export const builderHttpsUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
}, 'Trusted HTTPS URL required');
export const builderReadinessSchema = z
  .object({
    missingItems: z.array(z.string().min(1).max(500)).max(50),
    ready: z.boolean(),
  })
  .strict();
export const BUILDER_EDITOR_URL = 'https://usebaci.com/builder' as const;
export const BUILDER_POLICY_NAMESPACE = 'baci.website-builder' as const;
export const BUILDER_POLICY_VERSION = 1;

export const BUILDER_REQUEST_BYTES = 65536;
