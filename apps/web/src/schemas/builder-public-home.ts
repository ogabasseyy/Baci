import { z } from 'zod';
export const builderPublicHomeSchema = z
  .object({
    config: z.unknown(),
    publishedVersion: z
      .string()
      .regex(
        /^published:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
      ),
  })
  .strict();
export const builderPublicContentDigestSchema = z
  .string()
  .regex(/^home-v1:[a-f0-9]{64}$/);
