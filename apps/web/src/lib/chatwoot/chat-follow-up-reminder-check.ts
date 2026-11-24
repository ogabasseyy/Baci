import 'server-only';

import {
  getMerchantInboxConversation,
  type MerchantInboxFailure,
} from './merchant-inbox-client';
import {
  getMerchantInboxBinding,
  type MerchantInboxBinding,
} from './merchant-inbox-config';

/**
 * - `due`: the chat engine still shows the follow-up as pending: the chat is
 *   not finished and still carries the follow-up label.
 * - `stale`: it does not (Done, label removed, or snoozed to another time).
 * - `unknown`: the engine could not be read; the reminder is left for the next
 *   sweep instead of guessing.
 */
export type FollowUpCheck = 'due' | 'stale' | 'unknown';

/** The engine may round a snooze by a few seconds. */
const SNOOZE_TOLERANCE_MS = 60_000;

type Dependencies = {
  getBinding: (merchantId: string) => MerchantInboxBinding | null;
  getConversation: typeof getMerchantInboxConversation;
};

const defaults: Dependencies = {
  getBinding: (merchantId) => getMerchantInboxBinding(merchantId),
  getConversation: getMerchantInboxConversation,
};

/**
 * Best-effort confirmation, just before a reminder is pushed, that the chat
 * still needs it. A chat marked Done, or whose follow-up was cleared or moved
 * in the chat engine itself, must not push a wrong reminder.
 */
export async function checkFollowUpStillDue(
  reminder: { merchantId: string; conversationId: number; dueAt: string },
  deps: Dependencies = defaults
): Promise<FollowUpCheck> {
  const binding = deps.getBinding(reminder.merchantId);
  if (!binding) return 'unknown';
  const read = await deps.getConversation(binding, reminder.conversationId);
  if (!read.ok) return readFailure(read);
  const { conversation } = read;
  if (conversation.status === 'resolved' || conversation.followUp !== true) {
    return 'stale';
  }
  if (conversation.status === 'snoozed') {
    // A snooze with no time is not the one the reminder was set for.
    if (!conversation.snoozedUntil) return 'stale';
    const snoozedAt = Date.parse(conversation.snoozedUntil);
    const dueAt = Date.parse(reminder.dueAt);
    if (
      Number.isNaN(snoozedAt) ||
      Number.isNaN(dueAt) ||
      Math.abs(snoozedAt - dueAt) > SNOOZE_TOLERANCE_MS
    ) {
      return 'stale';
    }
  }
  return 'due';
}

function readFailure(failure: MerchantInboxFailure): FollowUpCheck {
  return failure.code === 'not_found' ? 'stale' : 'unknown';
}
