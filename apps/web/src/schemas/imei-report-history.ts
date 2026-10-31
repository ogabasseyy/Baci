import { z } from 'zod';
import { RouteIdentifierSchema } from './route-identifier';
export const imeiReportHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(0).max(100000).default(0),
  merchantSlug: RouteIdentifierSchema.optional(),
});
