import { z } from 'zod';

export const adminAnalyticsQuerySchema = z.object({
  period: z.enum(['7d', '30d', '90d', 'all']).optional().default('all'),
});

export type AdminAnalyticsPeriod = z.infer<
  typeof adminAnalyticsQuerySchema
>['period'];
