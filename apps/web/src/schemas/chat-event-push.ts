import { z } from 'zod';

/** One device row returned by the chat push token wrapper. */
export const chatEventPushTokenRowSchema = z.object({
  token: z.string().min(1),
  platform: z.string().min(1),
});

/** What the token wrapper returns: a list of device rows, or nothing. */
export const chatEventPushTokenRowsSchema = z
  .array(chatEventPushTokenRowSchema)
  .nullish()
  .transform((rows) => rows ?? []);
