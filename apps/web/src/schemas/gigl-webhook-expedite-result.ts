import z from 'zod';

/** Result of `gigl_worker_expedite_tracking_monitor`. */
export const giglWebhookExpediteResultSchema = z.object({
  matched: z.number().int().min(0),
  expedited: z.number().int().min(0),
});

export type GiglWebhookExpediteResult = z.infer<
  typeof giglWebhookExpediteResultSchema
>;
