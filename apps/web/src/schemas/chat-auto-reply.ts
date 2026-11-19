import { z } from 'zod';

/** Below this the assistant hands the conversation to a person. */
export const CHAT_AUTO_REPLY_MIN_CONFIDENCE = 0.6;
export const CHAT_AUTO_REPLY_MAX_LENGTH = 1000;

/** What the model must return; anything else counts as a failed attempt. */
export const chatAutoReplySchema = z.object({
  reply: z.string().trim().max(CHAT_AUTO_REPLY_MAX_LENGTH),
  confidence: z.number().min(0).max(1),
  needsHuman: z.boolean(),
});

export type ChatAutoReply = z.infer<typeof chatAutoReplySchema>;
