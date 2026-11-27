import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MerchantInboxUpdate } from '@/schemas/merchant-inbox-manage';
import { clearChatFollowUpReminder } from './chat-follow-up-reminder-clear';
import { reminderCustomerName } from './chat-follow-up-reminder-name';
import type { ObservedFollowUp } from './chat-follow-up-reminder-observe';
import { saveChatFollowUpReminder } from './chat-follow-up-reminder-save';
import {
  type ReminderVersion,
  readChatFollowUpReminderVersion,
} from './chat-follow-up-reminder-version';

export type ChatFollowUpSyncResult =
  | 'saved'
  | 'cleared'
  | 'unchanged'
  | 'failed';

/** Writes tried before giving up on a chat that keeps being changed. */
const MAX_ATTEMPTS = 3;

/**
 * Keeps the pending reminder in step with a change the engine just accepted:
 * a follow-up time records (or replaces) it, and clearing the follow-up,
 * Done or reopening removes it (reopening cancels a snooze). A change that
 * touches neither (priority, tags) leaves it alone.
 *
 * Two team members may change one chat at nearly the same moment. The write
 * only goes over the reminder read before the chat was changed; if that one
 * was written meanwhile, the reminder and then the chat are read again, so the
 * older request stands down and the newer one still lands.
 *
 * Best effort and never throws: the chat has already been changed, so a
 * failure here only costs the reminder and is logged without customer text.
 */
export async function syncChatFollowUpReminder(
  client: Pick<SupabaseClient, 'from'>,
  input: {
    merchantId: string;
    conversationId: number;
    update: MerchantInboxUpdate;
    customerName: string;
    /** The reminder's version, read before the chat was changed. */
    seen: ReminderVersion;
    /**
     * What the engine showed when it was read back after the change. If it
     * shows another follow-up than this change left (a different snooze time
     * after a set, a pending snooze after a clear), another team member
     * changed the follow-up and their sync owns the reminder.
     */
    observed?: ObservedFollowUp;
    /** Reads the chat again after the reminder turned out to have changed. */
    recheck: () => Promise<ObservedFollowUp | undefined>;
  }
): Promise<ChatFollowUpSyncResult> {
  const { update } = input;
  const requestedAt =
    typeof update.followUpAt === 'string' ? update.followUpAt : null;
  const cancels =
    update.followUpAt === null ||
    update.status === 'resolved' ||
    update.status === 'open';
  if (requestedAt === null && !cancels) return 'unchanged';
  const wanted = requestedAt === null ? 'cleared' : 'saved';
  const chat = {
    merchantId: input.merchantId,
    conversationId: input.conversationId,
  };
  try {
    let version = input.seen;
    let observed = input.observed;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      if (attempt > 0 || input.seen === undefined) {
        // Reminder first, chat second: a write in between is then caught.
        version = await readChatFollowUpReminderVersion(client, chat);
        observed = await input.recheck();
        if (!observed) break;
      }
      if (supersededByAnotherSet(requestedAt, observed)) return 'unchanged';
      if (version === undefined) continue;
      const outcome =
        requestedAt === null
          ? await clearChatFollowUpReminder(client, { ...chat, version })
          : await saveChatFollowUpReminder(client, {
              ...chat,
              version,
              dueAt: new Date(requestedAt).toISOString(),
              customerName: reminderCustomerName(input.customerName),
            });
      if (outcome === 'done') return report(true, wanted, input);
      if (outcome === 'failed') break;
    }
    return report(false, wanted, input);
  } catch {
    return report(false, wanted, input);
  }
}

/** The engine may round a snooze by a few seconds. */
const SNOOZE_TOLERANCE_MS = 60_000;

/**
 * True when the engine shows a follow-up this request did not leave: after a
 * set, another snooze time than the requested one; after a clear, Done or
 * reopen (which all remove the follow-up), a snooze still pending. A
 * concurrent change won, and applying this request to the reminder would lose
 * the newer follow-up.
 */
function supersededByAnotherSet(
  requestedAt: string | null,
  observed: ObservedFollowUp | undefined
): boolean {
  if (!observed) return false;
  if (requestedAt === null) {
    return observed.status === 'snoozed' && observed.followUp === true;
  }
  if (!observed.snoozedUntil) return false;
  const seen = Date.parse(observed.snoozedUntil);
  const requested = Date.parse(requestedAt);
  if (Number.isNaN(seen) || Number.isNaN(requested)) return false;
  return Math.abs(seen - requested) > SNOOZE_TOLERANCE_MS;
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
