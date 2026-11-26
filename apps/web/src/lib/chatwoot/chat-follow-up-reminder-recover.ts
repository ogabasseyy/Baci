import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MerchantInboxUpdate } from '@/schemas/merchant-inbox-manage';
import { holdUnconfirmedChatFollowUpReminder } from './chat-follow-up-reminder-hold';
import { reminderCustomerName } from './chat-follow-up-reminder-name';
import { syncChatFollowUpReminder } from './chat-follow-up-reminder-sync';
import { getMerchantInboxConversation } from './merchant-inbox-client';
import type { MerchantInboxBinding } from './merchant-inbox-config';
import type { SentFollowUp } from './merchant-inbox-manage-client';

/** The engine may round a snooze by a few seconds. */
const SNOOZE_TOLERANCE_MS = 60_000;

/**
 * For a change that ended in an error. A change is several writes, so the
 * engine may have the follow-up although a later write or the read-back failed.
 * It is recorded when the engine applied the snooze or shows it. A snooze sent
 * without a clear answer may still land, so its time is held unless another
 * reminder is pending. Otherwise nothing is touched. Best effort, never throws.
 */
export async function recoverAcceptedFollowUpReminder(
  client: Pick<SupabaseClient, 'from'>,
  binding: MerchantInboxBinding,
  input: {
    conversationId: number;
    update: MerchantInboxUpdate;
    /** Set when the snooze was sent and not refused. */
    sent?: SentFollowUp;
  }
): Promise<void> {
  const { conversationId, update, sent } = input;
  const requestedAt = update.followUpAt;
  if (typeof requestedAt !== 'string') return;
  const read = await getMerchantInboxConversation(binding, conversationId);
  const shown = read.ok ? read.conversation : undefined;
  const drift =
    shown?.status === 'snoozed' && shown.snoozedUntil
      ? Math.abs(Date.parse(shown.snoozedUntil) - Date.parse(requestedAt))
      : Number.NaN;
  // An unreadable time (NaN) never counts as shown.
  if (drift <= SNOOZE_TOLERANCE_MS || sent?.state === 'applied') {
    const customerName = shown?.customerName ?? sent?.customerName ?? '';
    await syncChatFollowUpReminder(client, {
      merchantId: binding.merchantId,
      conversationId,
      update,
      customerName,
      // A snooze to another time here means a newer change won.
      observed: shown && {
        status: shown.status,
        followUp: shown.followUp,
        snoozedUntil: shown.snoozedUntil,
      },
    });
    return;
  }
  if (!sent) return;
  try {
    const held = await holdUnconfirmedChatFollowUpReminder(client, {
      merchantId: binding.merchantId,
      conversationId,
      dueAt: new Date(requestedAt).toISOString(),
      customerName: reminderCustomerName(
        shown?.customerName ?? sent.customerName
      ),
    });
    if (held) return;
  } catch {
    // Logged below: the change already failed and must stay a plain failure.
  }
  console.warn('Chat follow-up reminder was not recorded', {
    merchantId: binding.merchantId,
    conversationId,
    wanted: 'held',
  });
}
