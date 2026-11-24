import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/** Removes a chat's pending reminder. Returns false when the delete failed. */
export async function clearChatFollowUpReminder(
  client: Pick<SupabaseClient, 'from'>,
  input: { merchantId: string; conversationId: number }
): Promise<boolean> {
  const { error } = await client
    .from('chat_follow_up_reminders')
    .delete()
    .eq('merchant_id', input.merchantId)
    .eq('conversation_id', input.conversationId);
  return !error;
}
