import 'server-only';

import type { DueChatFollowUpReminder } from '@/schemas/chat-follow-up-reminder';
import { sendChatEventPush } from './chat-event-push';
import { chatFollowUpEventKey } from './chat-follow-up-event-key';
import { checkFollowUpStillDue } from './chat-follow-up-reminder-check';
import { listDueChatFollowUpReminders } from './chat-follow-up-reminder-list';
import { reminderCustomerName } from './chat-follow-up-reminder-name';
import { recordChatFollowUpReminder } from './chat-follow-up-reminder-record';

export type ChatFollowUpSweepSummary = {
  /** Reminders that were due and unhandled when the sweep started. */
  due: number;
  /** A push went out (to at least one device). */
  sent: number;
  /** Taken without a push: store muted, chat finished or follow-up changed. */
  skipped: number;
  /** Left for the next sweep: the chat engine could not be read. */
  waiting: number;
  /** A step failed; a failed push is never retried, an unrecorded reminder is. */
  failed: number;
};

/** Stop starting reminders after this long, so one sweep fits its time limit. */
const SWEEP_BUDGET_MS = 40_000;

type Dependencies = {
  now: () => number;
  list: typeof listDueChatFollowUpReminders;
  check: typeof checkFollowUpStillDue;
  record: typeof recordChatFollowUpReminder;
  push: typeof sendChatEventPush;
};

const defaults: Dependencies = {
  now: () => Date.now(),
  list: listDueChatFollowUpReminders,
  check: checkFollowUpStillDue,
  record: recordChatFollowUpReminder,
  push: sendChatEventPush,
};

type Handled = keyof Omit<ChatFollowUpSweepSummary, 'due'>;

async function handleReminder(
  reminder: DueChatFollowUpReminder,
  deps: Dependencies
): Promise<Handled> {
  const verdict = await deps.check({
    merchantId: reminder.merchant_id,
    conversationId: reminder.conversation_id,
    dueAt: reminder.due_at,
  });
  // The engine could not be read: send nothing, take nothing, try again next
  // sweep (the database stops listing it a day after it came due).
  if (verdict === 'unknown') return 'waiting';

  // The one atomic take. Only an answer of "notified" may push, and only the
  // sweep that took the reminder gets it, so a repeat or a parallel sweep
  // never pushes twice.
  const recorded = await deps.record({
    merchantId: reminder.merchant_id,
    reminderId: reminder.reminder_id,
    send: verdict === 'due',
  });
  if (!recorded.ok) return 'failed';
  if (recorded.outcome !== 'notified') return 'skipped';

  const push = await deps
    .push({
      merchantId: reminder.merchant_id,
      eventKey: chatFollowUpEventKey(reminder.reminder_id),
      conversationId: reminder.conversation_id,
      // Re-cleaned here too, so the neutral title holds for any writer of the row.
      customerName: reminderCustomerName(reminder.customer_name),
      preview: '',
      kind: 'follow_up',
    })
    .catch(() => ({ status: 'failed' as const }));
  if (push.status === 'sent' || push.status === 'partial') return 'sent';
  if (push.status === 'skipped' && push.reason !== 'not_configured') {
    return 'skipped';
  }
  return 'failed';
}

/**
 * Pushes the follow-up reminders that came due. Each one is checked against
 * the chat engine, taken exactly once through the database, and pushed with
 * the same claim-based push as other chat alerts. Never throws for one
 * reminder's failure: the others still go out.
 */
export async function sweepChatFollowUpReminders(
  deps: Dependencies = defaults
): Promise<
  | { ok: true; summary: ChatFollowUpSweepSummary }
  | { ok: false; code: 'not_configured' | 'unavailable' }
> {
  const listed = await deps.list();
  if (!listed.ok) return listed;

  const summary: ChatFollowUpSweepSummary = {
    due: listed.reminders.length,
    sent: 0,
    skipped: 0,
    waiting: 0,
    failed: 0,
  };
  const startedAt = deps.now();
  for (const reminder of listed.reminders) {
    if (deps.now() - startedAt > SWEEP_BUDGET_MS) {
      // Untouched reminders stay unhandled and are picked up by the next sweep.
      summary.waiting += 1;
      continue;
    }
    let handled: Handled;
    try {
      handled = await handleReminder(reminder, deps);
    } catch {
      handled = 'failed';
    }
    summary[handled] += 1;
    if (handled === 'failed') {
      // Ids only: never customer text or names.
      console.warn('Chat follow-up reminder was not pushed', {
        merchantId: reminder.merchant_id,
        reminderId: reminder.reminder_id,
      });
    }
  }
  return { ok: true, summary };
}
