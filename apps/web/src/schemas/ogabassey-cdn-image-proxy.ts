import { z } from 'zod';
import {
  type ParsedOgabasseyCdnImageProxyPath,
  parseOgabasseyCdnImageProxyPath,
} from '@/lib/parse-ogabassey-cdn-image-proxy-path';

export const ogabasseyCdnImageProxyPathSchema = z
  .array(z.string().min(1))
  .min(3)
  .transform((segments, ctx) => {
    const parsed = parseOgabasseyCdnImageProxyPath(segments);
    if (!parsed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid or unsupported CDN image proxy path',
      });
      return z.NEVER;
    }
    return parsed;
  });

export type OgabasseyCdnImageProxyRequest = ParsedOgabasseyCdnImageProxyPath;
