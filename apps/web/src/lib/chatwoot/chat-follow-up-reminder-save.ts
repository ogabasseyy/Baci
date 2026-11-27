import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * How a conditional reminder write ended. `conflict`: the reminder is no longer
 * the one that was read, so nothing was written.
 */
export type ReminderWrite = 'done' | 'conflict' | 'failed';

/**
 * Records (or replaces) the one pending reminder of a chat, under the
 * signed-in team member's own session: row-level security lets only the
 * store's owner and staff with the inbox edit permission write it. It writes
 * only over the reminder that was read (`version`; null when the chat had
 * none), so a newer one is never replaced. The database assigns the identity
 * and delivery history: a new time gets a new id, so a reminder replaced after
 * a sweep listed it can never be taken by that sweep.
 */
export async function saveChatFollowUpReminder(
  client: Pick<SupabaseClient, 'from'>,
  input: {
    merchantId: string;
    conversationId: number;
    dueAt: string;
    customerName: string;
    version: string | null;
  }
): Promise<ReminderWrite> {
  const values = {
    due_at: input.dueAt,
    customer_name: input.customerName,
  };
  if (input.version === null) {
    const { error } = await client.from('chat_follow_up_reminders').insert({
      merchant_id: input.merchantId,
      conversation_id: input.conversationId,
      ...values,
    });
    if (!error) return 'done';
    // Unique violation: a reminder was recorded for the chat meanwhile.
    return error.code === '23505' ? 'conflict' : 'failed';
  }
  const { data, error } = await client
    .from('chat_follow_up_reminders')
    .update(values)
    .eq('merchant_id', input.merchantId)
    .eq('conversation_id', input.conversationId)
    .eq('revision', input.version)
    .select('id');
  if (error) return 'failed';
  return data?.length ? 'done' : 'conflict';
}
