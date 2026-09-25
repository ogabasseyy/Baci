import { z } from 'zod';

export const jumiaOrderQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).prefault(50),
  offset: z.coerce.number().int().min(0).prefault(0),
  status: z.string().min(1).optional(),
  integrationId: z.uuid().optional(),
});
