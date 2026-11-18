import { z } from 'zod';
export const experienceAssetSchema = z.strictObject({
  mime: z.enum(['image/png', 'font/woff2']),
  bytes: z
    .instanceof(Uint8Array)
    .refine((b) => b.length > 0 && b.length <= 2097152),
  alt: z.string().max(500),
  focalPoint: z
    .strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
    .default({ x: 0.5, y: 0.5 }),
});
