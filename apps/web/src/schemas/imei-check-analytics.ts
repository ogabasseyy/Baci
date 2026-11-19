import { z } from 'zod';

const count = z.number().int().nonnegative();
export const imeiAnalyticsQuerySchema = z.object({
  period: z.enum(['7d', '30d', '90d', 'all']).default('30d'),
  merchantSlug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(100)
    .optional(),
});
export const imeiAnalyticsSchema = z.object({
  generatedAt: z.string(),
  summary: z.object({
    requests: count,
    completed: count,
    uniqueDevices: count,
    unidentified: count,
    matchedImages: count,
  }),
  topModels: z.array(
    z.object({
      brand: z.string(),
      model: z.string(),
      checks: count,
      uniqueDevices: count,
    })
  ),
  topVariants: z.array(
    z.object({
      brand: z.string(),
      model: z.string(),
      color: z.string().nullable(),
      storage: z.string().nullable(),
      checks: count,
    })
  ),
  topBrands: z.array(z.object({ brand: z.string(), checks: count })),
  services: z.array(z.object({ tier: z.string(), checks: count })),
});
export type ImeiCheckAnalytics = z.infer<typeof imeiAnalyticsSchema>;
