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

export const dueChatFollowUpReminderListSchema = z
  .array(dueChatFollowUpReminderSchema)
  .max(50);

export type DueChatFollowUpReminder = z.infer<
  typeof dueChatFollowUpReminderSchema
>;

/** Answer of `record_chat_follow_up_reminder`. */
export const chatFollowUpRecordResultSchema = z.object({
  outcome: z.enum(['notified', 'muted', 'ignored']),
});

export type ChatFollowUpRecordOutcome = z.infer<
  typeof chatFollowUpRecordResultSchema
>['outcome'];

/** Why a sweep database call produced no answer. */
export type ChatFollowUpIntakeFailure = {
  ok: false;
  code: 'not_configured' | 'unavailable';
};
