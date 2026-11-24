import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MerchantInboxUpdate } from '@/schemas/merchant-inbox-manage';
import { clearChatFollowUpReminder } from './chat-follow-up-reminder-clear';
import { reminderCustomerName } from './chat-follow-up-reminder-name';
import { saveChatFollowUpReminder } from './chat-follow-up-reminder-save';

export type ChatFollowUpSyncResult =
  | 'saved'
  | 'cleared'
  | 'unchanged'
  | 'failed';

/**
 * Keeps the pending reminder in step with a change the engine just accepted:
 * a follow-up time records (or replaces) it, and clearing the follow-up,
 * Done or reopening removes it (reopening cancels a snooze). A change that
 * touches neither (priority, tags) leaves it alone. Best effort and never
 * throws: the chat has already been changed, so a failure here only costs the
 * reminder and is logged without customer text.
 */
export async function syncChatFollowUpReminder(
  client: Pick<SupabaseClient, 'from'>,
  input: {
    merchantId: string;
    conversationId: number;
    update: MerchantInboxUpdate;
    customerName: string;
  }
): Promise<ChatFollowUpSyncResult> {
  const { update } = input;
  const wanted = typeof update.followUpAt === 'string' ? 'saved' : 'cleared';
  try {
    if (typeof update.followUpAt === 'string') {
      const saved = await saveChatFollowUpReminder(client, {
        merchantId: input.merchantId,
        conversationId: input.conversationId,
        dueAt: new Date(update.followUpAt).toISOString(),
        customerName: reminderCustomerName(input.customerName),
      });
      return report(saved, 'saved', input);
    }
    if (
      update.followUpAt === null ||
      update.status === 'resolved' ||
      update.status === 'open'
    ) {
      const cleared = await clearChatFollowUpReminder(client, {
        merchantId: input.merchantId,
        conversationId: input.conversationId,
      });
      return report(cleared, 'cleared', input);
    }
    return 'unchanged';
  } catch {
    return report(false, wanted, input);
  }
}

function report(
  ok: boolean,
  success: 'saved' | 'cleared',
  input: { merchantId: string; conversationId: number }
): ChatFollowUpSyncResult {
  if (ok) return success;
  console.warn('Chat follow-up reminder was not recorded', {
    merchantId: input.merchantId,
    conversationId: input.conversationId,
    wanted: success,
  });
  return 'failed';
}
