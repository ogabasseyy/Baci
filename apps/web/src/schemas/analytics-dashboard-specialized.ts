import { z } from 'zod';

const page = z.coerce.number().int().positive().default(1);
const limit = z.coerce.number().int().positive().max(100).default(20);

export const analyticsDashboardSpecializedSchemas = {
  customerSegmentsQuery: z.object({
    limit,
    page,
    segment: z.string().trim().min(1).max(100).optional(),
  }),
  inventoryAlertsAction: z.object({
    action: z.enum(['acknowledge', 'resolve']),
    alertIds: z.array(z.uuid()).min(1).max(100),
  }),
  inventoryAlertsQuery: z.object({
    status: z.enum(['active', 'acknowledged', 'resolved']).default('active'),
    type: z
      .enum([
        'low_stock',
        'out_of_stock',
        'predicted_stockout',
        'reorder_point',
      ])
      .optional(),
  }),
  inventoryForecastQuery: z.object({
    limit,
    lowStockOnly: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    page,
    productId: z.uuid().optional(),
  }),
} as const;
