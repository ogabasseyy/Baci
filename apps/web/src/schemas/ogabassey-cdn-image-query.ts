import { z } from 'zod';

const ALLOWED_IMAGE_VERSION_QUERY_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export const ogabasseyCdnImageProxySearchParamsSchema = z
  .object({
    v: z.string().regex(ALLOWED_IMAGE_VERSION_QUERY_PATTERN).optional(),
  })
  .strict();
