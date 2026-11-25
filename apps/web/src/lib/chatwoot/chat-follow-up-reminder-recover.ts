import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MerchantInboxUpdate } from '@/schemas/merchant-inbox-manage';
import { syncChatFollowUpReminder } from './chat-follow-up-reminder-sync';
import { getMerchantInboxConversation } from './merchant-inbox-client';
import type { MerchantInboxBinding } from './merchant-inbox-config';

/** The engine may round a snooze by a few seconds. */
const SNOOZE_TOLERANCE_MS = 60_000;

/**
 * For a change that ended in an error. A change is several writes, so the
 * engine may have accepted the follow-up before a later write or the read-back
 * failed. If it shows the chat snoozed to the requested time, the reminder is
 * recorded anyway; otherwise nothing is touched. Best effort, never throws.
 */
export async function recoverAcceptedFollowUpReminder(
  client: Pick<SupabaseClient, 'from'>,
  binding: MerchantInboxBinding,
  input: { conversationId: number; update: MerchantInboxUpdate }
): Promise<void> {
  const requestedAt = input.update.followUpAt;
  if (typeof requestedAt !== 'string') return;
  const read = await getMerchantInboxConversation(
    binding,
    input.conversationId
  );
  if (!read.ok) return;
  const { status, followUp, snoozedUntil, customerName } = read.conversation;
  if (status !== 'snoozed' || !snoozedUntil) return;
  const drift = Math.abs(Date.parse(snoozedUntil) - Date.parse(requestedAt));
  // Written this way round so an unreadable time (NaN) records nothing.
  if (!(drift <= SNOOZE_TOLERANCE_MS)) return;
  await syncChatFollowUpReminder(client, {
    merchantId: binding.merchantId,
    conversationId: input.conversationId,
    update: input.update,
    customerName,
    observed: { status, followUp, snoozedUntil },
  });
}
