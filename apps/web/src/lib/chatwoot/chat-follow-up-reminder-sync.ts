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
    /**
     * The snooze time the engine showed when it was read back after the
     * change. When it is a different time, another team member changed the
     * follow-up at the same moment and their sync owns the reminder.
     */
    observedSnoozedUntil?: string | null;
  }
): Promise<ChatFollowUpSyncResult> {
  const { update } = input;
  const wanted = typeof update.followUpAt === 'string' ? 'saved' : 'cleared';
  try {
    if (typeof update.followUpAt === 'string') {
      if (supersededByAnotherChange(update.followUpAt, input)) {
        return 'unchanged';
      }
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

/** The engine may round a snooze by a few seconds. */
const SNOOZE_TOLERANCE_MS = 60_000;

/**
 * True when the engine read-back shows another follow-up time than the one this
 * request set: a concurrent change won, and writing this older time over its
 * reminder would lose the newer follow-up. (A change landing between that
 * read-back and this write is not detectable without an engine version; the
 * sweep then finds the snooze moved, consumes the reminder as stale and the
 * newer change's own write is the one that matters.)
 */
function supersededByAnotherChange(
  requestedAt: string,
  input: { observedSnoozedUntil?: string | null }
): boolean {
  if (!input.observedSnoozedUntil) return false;
  const observed = Date.parse(input.observedSnoozedUntil);
  const requested = Date.parse(requestedAt);
  if (Number.isNaN(observed) || Number.isNaN(requested)) return false;
  return Math.abs(observed - requested) > SNOOZE_TOLERANCE_MS;
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
