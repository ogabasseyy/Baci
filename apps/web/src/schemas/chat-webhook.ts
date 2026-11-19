import { z } from 'zod';

const providerId = z.number().int().positive().safe();

/** Every chat webhook carries an event name; anything else is malformed. */
export const chatWebhookEnvelopeSchema = z.object({
  event: z.string().min(1).max(80),
});

/**
 * A new message event. Only the fields the notification needs are validated;
 * the rest of the provider's conversation snapshot is ignored.
 */
export const chatWebhookMessageCreatedSchema = z.object({
  event: z.literal('message_created'),
  id: providerId,
  message_type: z.string().max(40),
  private: z.boolean().nullish(),
  content: z.string().nullish(),
  account: z.object({ id: providerId }),
  inbox: z.object({ id: providerId }),
  conversation: z.object({
    id: providerId,
    status: z.string().max(40).nullish(),
    labels: z.array(z.string().max(100)).max(50).nullish(),
  }),
  sender: z
    .object({ name: z.string().nullish(), type: z.string().max(40).nullish() })
    .nullish(),
});

export type ChatWebhookMessageCreated = z.infer<
  typeof chatWebhookMessageCreatedSchema
>;

/** Result of the database intake function. */
export const chatEventIntakeResultSchema = z.object({
  outcome: z.enum(['notified', 'coalesced', 'muted', 'ignored']),
  duplicate: z.boolean().optional(),
});

export type ChatEventIntakeOutcome = z.infer<
  typeof chatEventIntakeResultSchema
>['outcome'];
