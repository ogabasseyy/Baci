import { z } from 'zod';

const ALLOWED_ASSET_PREFIX_PATTERN = /^core-assets\/(?:products|blog)\//;
const ALLOWED_ASSET_EXTENSION_PATTERN = /\.(?:avif|jpe?g|png|webp)$/i;
const FORBIDDEN_PATH_PATTERN = /(?:^|\/)\.\.(?:\/|$)|\\|\0|%(?:2e|2f|5c)/i;

export const ogabasseyCdnImageTransformOptionsSchema = z.object({
  fit: z.enum(['inside', 'cover']).default('inside'),
  format: z.enum(['avif', 'jpeg', 'jpg', 'png', 'webp']),
  height: z.coerce.number().int().min(16).max(3840).optional(),
  quality: z.coerce.number().int().min(1).max(100),
  width: z.coerce.number().int().min(16).max(3840),
});

export const ogabasseyCdnImageProxyPathSchema = z
  .array(z.string().min(1))
  .min(3)
  .transform((segments, ctx) => {
    const [rawOptionsSegment, ...assetSegments] = segments;
    const rawOptionsMap = new Map<string, string>();

    for (const pair of rawOptionsSegment.split(',')) {
      const separatorIdx = pair.indexOf('=');
      if (separatorIdx <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Malformed transform option token',
        });
        return z.NEVER;
      }
      const key = pair.slice(0, separatorIdx).trim().toLowerCase();
      const value = pair
        .slice(separatorIdx + 1)
        .trim()
        .toLowerCase();
      rawOptionsMap.set(key, value);
    }

    const parsedOptions = ogabasseyCdnImageTransformOptionsSchema.safeParse({
      fit: rawOptionsMap.get('fit'),
      format: rawOptionsMap.get('format'),
      height: rawOptionsMap.get('height'),
      quality: rawOptionsMap.get('quality'),
      width: rawOptionsMap.get('width'),
    });

    if (!parsedOptions.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid image transform options',
      });
      return z.NEVER;
    }

    const assetPath = assetSegments.join('/');
    if (
      FORBIDDEN_PATH_PATTERN.test(assetPath) ||
      !ALLOWED_ASSET_PREFIX_PATTERN.test(assetPath) ||
      !ALLOWED_ASSET_EXTENSION_PATTERN.test(assetPath)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Untrusted or unsupported CDN asset path',
      });
      return z.NEVER;
    }

    return {
      assetPath,
      options: parsedOptions.data,
    };
  });

export type OgabasseyCdnImageProxyRequest = z.infer<
  typeof ogabasseyCdnImageProxyPathSchema
>;
