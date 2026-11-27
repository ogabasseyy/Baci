import 'server-only';

import type { DueChatFollowUpReminder } from '@/schemas/chat-follow-up-reminder';
import { sendChatEventPush } from './chat-event-push';
import { chatFollowUpEventKey } from './chat-follow-up-event-key';
import { checkFollowUpStillDue } from './chat-follow-up-reminder-check';
import { listDueChatFollowUpReminders } from './chat-follow-up-reminder-list';
import { reminderCustomerName } from './chat-follow-up-reminder-name';
import { recordChatFollowUpReminder } from './chat-follow-up-reminder-record';
import { releaseChatFollowUpReminder } from './chat-follow-up-reminder-release';

export type ChatFollowUpSweepSummary = {
  /** Reminders that were due and unhandled when the sweep started. */
  due: number;
  /** A push went out (to at least one device). */
  sent: number;
  /**
   * Taken without a push: store muted, chat finished, follow-up changed or
   * still no registered device after the last take.
   */
  skipped: number;
  /** Left for the next sweep: the chat engine could not be read. */
  waiting: number;
  /** Left for the next sweep: the time budget ran out before its turn. */
  deferred: number;
  /** Nothing reached the provider (no device either): put back for later. */
  retrying: number;
  /** A step failed and the push is not retried (an unrecorded reminder is). */
  failed: number;
};

/**
 * Stop starting reminders after this long: half the route's 60-second limit,
 * so the last one started (engine read and push) has room to finish.
 */
const SWEEP_BUDGET_MS = 30_000;

type Dependencies = {
  now: () => number;
  /** A number from 0 up to, not including, 1: where in the batch to start. */
  random: () => number;
  list: typeof listDueChatFollowUpReminders;
  check: typeof checkFollowUpStillDue;
  record: typeof recordChatFollowUpReminder;
  push: typeof sendChatEventPush;
  release: typeof releaseChatFollowUpReminder;
};

const defaults: Dependencies = {
  now: () => Date.now(),
  random: () => Math.random(),
  list: listDueChatFollowUpReminders,
  check: checkFollowUpStillDue,
  record: recordChatFollowUpReminder,
  push: sendChatEventPush,
  release: releaseChatFollowUpReminder,
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
    // A throw says nothing about what left the server: never retried.
    .catch(() => ({ status: 'failed' as const, nothingSent: false }));
  const release = () =>
    deps.release({
      merchantId: reminder.merchant_id,
      reminderId: reminder.reminder_id,
      take: recorded.take,
    });
  // No device to deliver to: a phone may register before the next sweep.
  if (push.status === 'sent' && push.noDevices) {
    return (await release()) ? 'retrying' : 'skipped';
  }
  if (push.status === 'sent' || push.status === 'partial') return 'sent';
  if (push.status === 'skipped' && push.reason !== 'not_configured') {
    return 'skipped';
  }
  // Missing configuration or a failure before sending: nothing left the server.
  const nothingSent = push.status === 'skipped' || push.nothingSent;
  if (nothingSent && (await release())) return 'retrying';
  return 'failed';
}

/**
 * Pushes the follow-up reminders that came due. Each one is checked against
 * the chat engine, taken exactly once through the database, and pushed with
 * the same claim-based push as other chat alerts. A reminder is taken before
 * the push so it can never go out twice. A push that provably never reached
 * the provider (including a store with no registered device) is put back for
 * a later sweep, and so is one whose run stopped before sending began (the
 * database does that), three takes at most, spaced ten minutes then two hours
 * apart. Only a push that may have left is given up. Never throws for one
 * reminder's failure: the others still go out.
 *
 * Each run starts at a random place in the batch and wraps round: slow
 * reminders at the front would otherwise use up the time budget every run and
 * leave the ones behind them until their day had passed.
 *
 * Delivery is at most once on purpose. "May have left" starts at the mark
 * written just before the request to the delivery provider, so a run killed
 * between the two loses that one push: sending first would instead risk
 * sending it twice.
 *
 * Known limit: the chat is checked just before the take, not again while the
 * push is being sent, so a Done or a cleared follow-up landing in that moment
 * can still be followed by this one push.
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
    deferred: 0,
    retrying: 0,
    failed: 0,
  };
  const startedAt = deps.now();
  const start = Math.floor(deps.random() * listed.reminders.length);
  for (const reminder of [
    ...listed.reminders.slice(start),
    ...listed.reminders.slice(0, start),
  ]) {
    if (deps.now() - startedAt > SWEEP_BUDGET_MS) {
      // Untouched reminders stay unhandled and are picked up by the next sweep.
      summary.deferred += 1;
      continue;
    }
    let handled: Handled;
    try {
      handled = await handleReminder(reminder, deps);
    } catch {
      handled = 'failed';
    }
    summary[handled] += 1;
    if (handled === 'failed' || handled === 'retrying') {
      // Ids only: never customer text or names.
      console.warn('Chat follow-up reminder was not pushed', {
        retrying: handled === 'retrying',
        merchantId: reminder.merchant_id,
        reminderId: reminder.reminder_id,
      });
    }
  }
  return { ok: true, summary };
}
