import z from 'zod';

/**
 * The only two fields read from a delivery that failed the full event
 * schema, so the quarantine row can still carry them for triage. Anything
 * else in the body is ignored, and a field of the wrong type or length is
 * dropped by the caller rather than trusted.
 */
export const MAX_CORRELATION_FIELD_LENGTH = 200;

export const piggyvestWebhookCorrelationSchema = z.object({
  eventId: z.string().min(1).max(MAX_CORRELATION_FIELD_LENGTH).optional(),
  eventType: z.string().min(1).max(MAX_CORRELATION_FIELD_LENGTH).optional(),
});

export type PiggyvestWebhookCorrelation = z.infer<
  typeof piggyvestWebhookCorrelationSchema
>;
