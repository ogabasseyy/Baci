import { z } from 'zod';

/** Most reminders one sweep handles; the database function accepts up to 50. */
export const CHAT_FOLLOW_UP_SWEEP_LIMIT = 25;

/** One reminder that came due, as `list_due_chat_follow_up_reminders` returns it. */
export const dueChatFollowUpReminderSchema = z.object({
  reminder_id: z.uuid(),
  merchant_id: z.uuid(),
  conversation_id: z.number().int().positive(),
  due_at: z.string().min(1).max(64),
  customer_name: z.string().max(80),
});

/** The write stamp of a chat's pending reminder, read before changing it. */
export const chatFollowUpReminderVersionSchema = z.object({
  revision: z.string().min(1).max(64),
});

/** The listed rows, each still unchecked: one bad row must not reject the rest. */
export const dueChatFollowUpReminderListSchema = z.array(z.unknown()).max(50);

export type DueChatFollowUpReminder = z.infer<
  typeof dueChatFollowUpReminderSchema
>;

/**
 * Answer of `record_chat_follow_up_reminder`. A take that may be pushed is
 * numbered, so only that take can be put back.
 */
export const chatFollowUpRecordResultSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('notified'),
    take: z.number().int().min(1).max(3),
  }),
  z.object({ outcome: z.enum(['muted', 'ignored']) }),
]);

export type ChatFollowUpRecordResult = z.infer<
  typeof chatFollowUpRecordResultSchema
>;

/** Why a sweep database call produced no answer. */
export type ChatFollowUpIntakeFailure = {
  ok: false;
  code: 'not_configured' | 'unavailable';
};
