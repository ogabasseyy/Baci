import { z } from 'zod';
import { adminSafeErrorCodeSchema } from './admin-safe-error-code';

const ingressIncidentSchema = z.strictObject({
  event_name: z.string(),
  failure_code: adminSafeErrorCodeSchema,
  first_failed_at: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  last_failed_at: z.iso.datetime({ offset: true }),
  replay_count: z.number().int().nonnegative(),
});

export const eventPipelineIngressListSchema = z.strictObject({
  count: z.number().int().nonnegative(),
  items: z.array(ingressIncidentSchema),
});

export type EventPipelineIngressList = z.infer<
  typeof eventPipelineIngressListSchema
>;
