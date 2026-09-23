import { z } from 'zod';

export const dashboardMerchantActionArgsSchema = z.object({
  merchantId: z.string().trim().min(1).max(128),
});

export const dashboardRecentSalesArgsSchema =
  dashboardMerchantActionArgsSchema.extend({
    limit: z.int().min(1).max(50).default(5),
  });

const dashboardMetricValueSchema = z.object({
  change: z.number(),
  value: z.number(),
});

export const dashboardMetricsResultSchema = z.object({
  activeNow: dashboardMetricValueSchema,
  aov: z.number(),
  customers: dashboardMetricValueSchema,
  fulfillmentRate: z.number(),
  orders: dashboardMetricValueSchema,
  revenue: dashboardMetricValueSchema,
});
