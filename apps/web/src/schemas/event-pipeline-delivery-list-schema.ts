import { z } from 'zod';
import { nullableAdminSafeErrorCodeSchema } from './admin-safe-error-code';

const deliveryIncidentSchema = z.strictObject({
  attempts: z.number().int().nonnegative(),
  created_at: z.iso.datetime({ offset: true }),
  destination: z.string(),
  event_name: z.string(),
  id: z.uuid(),
  last_error_code: nullableAdminSafeErrorCodeSchema,
  replay_count: z.number().int().nonnegative(),
  status: z.enum(['dead_letter', 'delivery_unknown']),
  updated_at: z.iso.datetime({ offset: true }),
});

export const eventPipelineDeliveryListSchema = z.strictObject({
  count: z.number().int().nonnegative(),
  items: z.array(deliveryIncidentSchema),
});

export type EventPipelineDeliveryList = z.infer<
  typeof eventPipelineDeliveryListSchema
>;
