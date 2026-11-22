import { z } from 'zod';

/** Below this the assistant hands the conversation to a person. */
export const CHAT_AUTO_REPLY_MIN_CONFIDENCE = 0.6;
/** Longest customer text sent to a model; the rest is cut. */
export const CHAT_AUTO_REPLY_MAX_QUESTION_LENGTH = 2000;
export const CHAT_AUTO_REPLY_MAX_LENGTH = 1000;

/** What the customer is doing, as the model reads their message. */
export const CHAT_AUTO_REPLY_INTENTS = [
  'discover',
  'recommend',
  'details',
  'add_to_cart',
  'other',
] as const;

/** Santa mode only: the same intents plus a Santa wish. */
export const CHAT_AUTO_REPLY_SANTA_INTENTS = [
  ...CHAT_AUTO_REPLY_INTENTS,
  'wish',
] as const;

/**
 * What the model must return; anything else counts as a failed attempt. The
 * intent is advisory: a missing or unknown one is dropped (the store then just
 * adds nothing extra) rather than failing an otherwise good reply.
 */
export const chatAutoReplySchema = z.object({
  reply: z.string().trim().max(CHAT_AUTO_REPLY_MAX_LENGTH),
  confidence: z.number().min(0).max(1),
  needsHuman: z.boolean(),
  intent: z.enum(CHAT_AUTO_REPLY_INTENTS).optional().catch(undefined),
});

/**
 * The reply shape in Santa mode. Kept apart from the normal schema so a store
 * with Santa mode off never offers the model a "wish" intent. A wish is only
 * ever a claim by the model: the store still verifies every price.
 */
export const chatAutoReplySantaSchema = chatAutoReplySchema.extend({
  intent: z.enum(CHAT_AUTO_REPLY_SANTA_INTENTS).optional().catch(undefined),
});

export type ChatAutoReply = z.infer<typeof chatAutoReplySchema>;

/** The provider's conversation read: status plus labels (default none). */
export const conversationSnapshotSchema = z.object({
  status: z.string(),
  labels: z.array(z.string()).max(50).default([]),
});
