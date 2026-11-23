import { z } from 'zod';

const chatwootDeliveryScopeSchema = z.object({
  conversationId: z.number().int().positive().safe(),
  sessionToken: z.string().min(1).max(12_000),
});

export const chatwootDeliveryMatchSchema = z.object({
  placeId: z.string().min(1).max(4000),
  label: z.string().min(1).max(500),
  googleSession: z.string().uuid(),
  expiresAt: z.number().int().safe(),
  proof: z.string().regex(/^[a-f0-9]{64}$/),
});

export type ChatwootDeliveryMatch = z.infer<typeof chatwootDeliveryMatchSchema>;

export const chatwootDeliveryConfirmationInputSchema = z.discriminatedUnion(
  'action',
  [
    chatwootDeliveryScopeSchema.extend({
      action: z.literal('search'),
      address: z.string().trim().min(3).max(300),
    }),
    chatwootDeliveryScopeSchema.extend({
      action: z.literal('decide'),
      answer: z.string().trim().min(1).max(160),
      match: chatwootDeliveryMatchSchema,
    }),
  ]
);

export const chatwootDeliveryDecisionSchema = z.object({
  decision: z.enum(['confirmed', 'different_address', 'unclear']),
});

export const chatwootDeliveryInputClassificationSchema = z.object({
  decision: z.enum(['address', 'side_question', 'unclear']),
});
