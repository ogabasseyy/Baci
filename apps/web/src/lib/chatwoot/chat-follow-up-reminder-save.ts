import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Records (or replaces) the one pending reminder of a chat, under the
 * signed-in team member's own session: row-level security lets only the
 * store's owner and staff with the inbox edit permission write it. The
 * database assigns the identity and delivery history: a new time gets a new
 * id, so a reminder replaced after a sweep listed it can never be taken by
 * that sweep. Returns false when the write failed.
 */
export async function saveChatFollowUpReminder(
  client: Pick<SupabaseClient, 'from'>,
  input: {
    merchantId: string;
    conversationId: number;
    dueAt: string;
    customerName: string;
  }
): Promise<boolean> {
  const { error } = await client.from('chat_follow_up_reminders').upsert(
    {
      merchant_id: input.merchantId,
      conversation_id: input.conversationId,
      due_at: input.dueAt,
      customer_name: input.customerName,
    },
    { onConflict: 'merchant_id,conversation_id' }
  );
  return !error;
}
