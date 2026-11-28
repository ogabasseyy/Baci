import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * For a snooze that got no clear answer: it may still land, so the time is
 * recorded now (the sweep checks the chat before pushing). A pending reminder
 * is never replaced by an unconfirmed time; a handled one for another time is
 * removed first so it does not block this one (one for this very time keeps its
 * history). Returns false when a write failed.
 */
export async function holdUnconfirmedChatFollowUpReminder(
  client: Pick<SupabaseClient, 'from'>,
  input: {
    merchantId: string;
    conversationId: number;
    dueAt: string;
    customerName: string;
  }
): Promise<boolean> {
  const removed = await client
    .from('chat_follow_up_reminders')
    .delete()
    .eq('merchant_id', input.merchantId)
    .eq('conversation_id', input.conversationId)
    .not('processed_at', 'is', null)
    .neq('due_at', input.dueAt);
  if (removed.error) return false;
  const { error } = await client.from('chat_follow_up_reminders').upsert(
    {
      merchant_id: input.merchantId,
      conversation_id: input.conversationId,
      due_at: input.dueAt,
      customer_name: input.customerName,
    },
    { onConflict: 'merchant_id,conversation_id', ignoreDuplicates: true }
  );
  return !error;
}
