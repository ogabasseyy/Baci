import { z } from 'zod';

export const ProductImageEntrySchema = z.union([
  z.string(),
  z
    .object({
      url: z.string().optional(),
      src: z.string().optional(),
      uri: z.string().optional(),
    })
    .refine((value) => Boolean(value.url || value.src || value.uri), {
      message: 'Expected at least one image source (url, src, or uri)',
    }),
]);
