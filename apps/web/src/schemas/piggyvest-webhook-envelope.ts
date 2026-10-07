import { z } from 'zod';
import { piggyvestEventIdSchema } from './piggyvest-event-id';

export const piggyvestWebhookEnvelopeSchema = z.object({
  eventId: piggyvestEventIdSchema,
  customer_id: z.string().min(1).max(512),
  eventType: z.string().min(1).max(512),
  eventCategory: z.string().min(1).max(512),
  eventData: z.record(z.string(), z.unknown()),
});
