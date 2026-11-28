import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { chatFollowUpReminderVersionSchema } from '@/schemas/chat-follow-up-reminder';

/**
 * The write stamp and time of a chat's pending reminder. `null`: the chat has
 * none. `undefined`: it could not be read.
 */
export type ReminderVersion =
  | { revision: string; dueAt: string }
  | null
  | undefined;

/** Never throws: the route reads it before it changes the chat. */
export async function readChatFollowUpReminderVersion(
  client: Pick<SupabaseClient, 'from'>,
  input: { merchantId: string; conversationId: number }
): Promise<ReminderVersion> {
  try {
    const { data, error } = await client
      .from('chat_follow_up_reminders')
      .select('revision, due_at')
      .eq('merchant_id', input.merchantId)
      .eq('conversation_id', input.conversationId)
      .maybeSingle();
    if (error) return undefined;
    if (data === null) return null;
    const row = chatFollowUpReminderVersionSchema.safeParse(data);
    if (!row.success) return undefined;
    return { revision: row.data.revision, dueAt: row.data.due_at };
  } catch {
    return undefined;
  }
}
