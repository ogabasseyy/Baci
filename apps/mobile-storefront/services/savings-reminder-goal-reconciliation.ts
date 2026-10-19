import {
  cancelStoredSavingsReminderNotification,
  type NotificationsModule,
} from './savings-reminder-scheduling';
import type {
  ReminderRecord,
  SavingsReminderScope,
} from './savings-reminder-storage';

/**
 * Destroys records whose goals reached a terminal state, cancelling their
 * live OS notifications. Takes a pre-fetched snapshot: the goals lookup
 * runs outside the reminder mutex (see activateDueSavingsReminderNotification)
 * so a slow network never blocks scheduling and cancellation. Anything not
 * in the terminal set is kept untouched.
 */
export async function retireTerminalGoalReminders(
  notifications: NotificationsModule | null,
  scope: SavingsReminderScope,
  records: ReminderRecord[],
  terminalGoalIds: ReadonlySet<string>
): Promise<ReminderRecord[]> {
  const live: ReminderRecord[] = [];
  for (const record of records) {
    if (!terminalGoalIds.has(record.goalId)) {
      live.push(record);
      continue;
    }
    await cancelStoredSavingsReminderNotification(
      notifications,
      scope,
      record.goalId
    );
  }
  return live;
}
