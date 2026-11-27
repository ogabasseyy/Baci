import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MerchantInboxUpdate } from '@/schemas/merchant-inbox-manage';
import { reminderDueAt } from './chat-follow-up-reminder-due-at';
import { holdUnconfirmedChatFollowUpReminder } from './chat-follow-up-reminder-hold';
import { reminderCustomerName } from './chat-follow-up-reminder-name';
import { observeChatFollowUp } from './chat-follow-up-reminder-observe';
import { syncChatFollowUpReminder } from './chat-follow-up-reminder-sync';
import type { ReminderVersion } from './chat-follow-up-reminder-version';
import { getMerchantInboxConversation } from './merchant-inbox-client';
import type { MerchantInboxBinding } from './merchant-inbox-config';
import type { SentFollowUp } from './merchant-inbox-manage-client';

/** The engine may round a snooze by a few seconds. */
const SNOOZE_TOLERANCE_MS = 60_000;

/**
 * For a change that ended in an error. A change is several writes, so the
 * engine may have taken the follow-up part although a later write or the
 * read-back failed.
 * - Setting a time: recorded when the engine applied the snooze or shows it. A
 *   snooze sent without a clear answer may still land, so its time is held
 *   unless another reminder is pending.
 * - Done, reopen or clear: when a status change was sent and not refused, the
 *   reminder follows the same rule as after a successful change (a chat still
 *   shown as snoozed with its follow-up keeps it). With no clear answer and a
 *   chat that cannot be read, it is left alone: the sweep checks the chat again
 *   before it pushes.
 * Otherwise nothing is touched. Best effort, never throws.
 */
export async function recoverAcceptedFollowUpReminder(
  client: Pick<SupabaseClient, 'from'>,
  binding: MerchantInboxBinding,
  input: {
    conversationId: number;
    update: MerchantInboxUpdate;
    /** The reminder's version, read before the chat was changed. */
    seen: ReminderVersion;
    /** Set when the snooze was sent and not refused. */
    sent?: SentFollowUp;
    /** Set when Done or a reopen was sent and not refused. */
    cancelSent?: SentFollowUp['state'];
  }
): Promise<void> {
  const { conversationId, update, seen, sent, cancelSent } = input;
  const recheck = () => observeChatFollowUp(binding, conversationId);
  const requestedAt = update.followUpAt;
  if (typeof requestedAt !== 'string' && !cancelSent) return;
  const read = await getMerchantInboxConversation(binding, conversationId);
  const shown = read.ok ? read.conversation : undefined;
  const observed = shown && {
    status: shown.status,
    followUp: shown.followUp,
    snoozedUntil: shown.snoozedUntil,
  };
  if (typeof requestedAt !== 'string') {
    // Nothing confirms the cancellation: the chat may still be snoozed.
    if (!shown && cancelSent === 'unconfirmed') return;
    await syncChatFollowUpReminder(client, {
      merchantId: binding.merchantId,
      conversationId,
      update,
      customerName: shown?.customerName ?? '',
      seen,
      observed,
      recheck,
    });
    return;
  }
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
      seen,
      // A snooze to another time here means a newer change won.
      observed,
      recheck,
    });
    return;
  }
  if (!sent) return;
  try {
    const held = await holdUnconfirmedChatFollowUpReminder(client, {
      merchantId: binding.merchantId,
      conversationId,
      dueAt: reminderDueAt(requestedAt),
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
