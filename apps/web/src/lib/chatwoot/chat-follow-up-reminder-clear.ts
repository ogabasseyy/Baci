import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReminderWrite } from './chat-follow-up-reminder-save';
import { readChatFollowUpReminderVersion } from './chat-follow-up-reminder-version';

/**
 * Removes a chat's pending reminder, only if it is the one that was read
 * (`version`; null when the chat had none). `conflict`: the chat holds another
 * reminder, which is left in place.
 */
export async function clearChatFollowUpReminder(
  client: Pick<SupabaseClient, 'from'>,
  input: {
    merchantId: string;
    conversationId: number;
    version: string | null;
  }
): Promise<ReminderWrite> {
  if (input.version !== null) {
    const { error } = await client
      .from('chat_follow_up_reminders')
      .delete()
      .eq('merchant_id', input.merchantId)
      .eq('conversation_id', input.conversationId)
      .eq('revision', input.version);
    if (error) return 'failed';
  }
  const left = await readChatFollowUpReminderVersion(client, input);
  if (left === undefined) return 'failed';
  return left === null ? 'done' : 'conflict';
}
