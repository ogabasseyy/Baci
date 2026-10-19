import { z } from 'zod';

export const adminHealthCheckSchema = z.object({
  check_name: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
  message: z.string().min(1),
  status: z.enum(['healthy', 'warning', 'critical']),
});

export const adminIndexRecommendationSchema = z.object({
  index_name: z.string().min(1),
  priority: z.enum(['high', 'medium', 'low']),
  reason: z.string().min(1),
  table_name: z.string().min(1),
});

export const adminSystemHealthSchema = z.object({
  checkedAt: z.iso.datetime(),
  health: z.array(adminHealthCheckSchema),
  indexRecommendations: z.array(adminIndexRecommendationSchema),
  missingIndexes: z.array(z.string().min(1)),
});

export type AdminSystemHealth = z.infer<typeof adminSystemHealthSchema>;
