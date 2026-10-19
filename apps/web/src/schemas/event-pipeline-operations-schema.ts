import { z } from 'zod';
import { nullableAdminSafeErrorCodeSchema } from './admin-safe-error-code';

const nullableTimestamp = z.iso.datetime({ offset: true }).nullable();

export const eventPipelineOperationsSchema = z.strictObject({
  deliveries: z.array(
    z.strictObject({
      delivery_count: z.number().int().nonnegative(),
      destination: z.string(),
      oldest_age_seconds: z.number().int().nonnegative(),
      status: z.string(),
    })
  ),
  heartbeats: z.array(
    z.strictObject({
      last_error_at: nullableTimestamp,
      last_error_code: nullableAdminSafeErrorCodeSchema,
      last_started_at: nullableTimestamp,
      last_succeeded_at: nullableTimestamp,
      processed_count: z.number().int().nonnegative(),
      updated_at: z.iso.datetime({ offset: true }),
      worker_name: z.string(),
    })
  ),
  queue: z
    .strictObject({
      measured_at: z.iso.datetime({ offset: true }),
      newest_message_age_seconds: z.number().int().nonnegative().nullable(),
      oldest_message_age_seconds: z.number().int().nonnegative().nullable(),
      queue_length: z.number().int().nonnegative(),
      total_messages: z.number().int().nonnegative(),
    })
    .nullable(),
});
