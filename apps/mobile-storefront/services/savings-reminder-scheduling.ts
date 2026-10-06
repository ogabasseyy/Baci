import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { createLogger } from '@/lib/logger';
import {
  type SavingsReminderRequest,
  type SavingsReminderScope,
  savingsReminderStorage,
} from './savings-reminder-storage';

export const SAVINGS_REMINDER_CHANNEL_ID = 'savings';
export type SavingsReminderFrequency = 'daily' | 'weekly' | 'monthly';
export type NotificationsModule = typeof import('expo-notifications');

const log = createLogger('SavingsReminderScheduling');

export function buildSavingsReminderTrigger({
  frequency,
  notifications,
  scheduledAt,
}: {
  frequency: SavingsReminderFrequency;
  notifications: NotificationsModule;
  scheduledAt: Date;
}) {
  const shared = {
    channelId: SAVINGS_REMINDER_CHANNEL_ID,
    hour: scheduledAt.getHours(),
    minute: scheduledAt.getMinutes(),
  };
  if (frequency === 'daily') {
    return {
      ...shared,
      type: notifications.SchedulableTriggerInputTypes.DAILY,
    };
  }
  if (frequency === 'weekly') {
    return {
      ...shared,
      type: notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: scheduledAt.getDay() + 1,
    };
  }
  return {
    ...shared,
    day: scheduledAt.getDate(),
    type: notifications.SchedulableTriggerInputTypes.MONTHLY,
  };
}

export async function cancelStoredSavingsReminderNotification(
  notifications: NotificationsModule | null,
  scope: SavingsReminderScope,
  goalId?: string
) {
  let removed = false;
  for (const record of await savingsReminderStorage.read(scope, goalId)) {
    if (record.notificationId) {
      if (!notifications) {
        await savingsReminderStorage.write({ ...record, pending: undefined });
        removed ||= Boolean(record.pending);
        continue;
      }
      try {
        await notifications.cancelScheduledNotificationAsync(
          record.notificationId
        );
      } catch (error) {
        log.debug(
          'Unable to cancel stored savings reminder notification',
          error
        );
        await savingsReminderStorage.write({ ...record, pending: undefined });
        removed ||= Boolean(record.pending);
        continue;
      }
    }
    removed ||= Boolean(record.notificationId || record.pending);
    await savingsReminderStorage.remove(scope, record.goalId);
  }
  return removed;
}

/**
 * One-way disposal of pre-scope records. Unscoped state cannot be attributed
 * to the current account, so any live OS notification is cancelled and the
 * record dropped — never adopted. Runs at every entry point (idempotent).
 */
export async function disposeUnscopedSavingsReminders(
  notifications: NotificationsModule | null
) {
  for (const record of await savingsReminderStorage.drainUnscoped()) {
    if (!record.notificationId || !notifications) continue;
    try {
      await notifications.cancelScheduledNotificationAsync(
        record.notificationId
      );
    } catch (error) {
      log.debug(
        'Unable to cancel unscoped savings reminder notification',
        error
      );
    }
  }
}

export async function scheduleRecurringSavingsReminder({
  notifications,
  request,
  scope,
}: {
  notifications: NotificationsModule;
  request: SavingsReminderRequest;
  scope: SavingsReminderScope;
}) {
  const notificationId = await notifications.scheduleNotificationAsync({
    content: {
      title: 'Savings reminder',
      body: `Add ${formatNgnCurrency(request.contributionAmount)} toward ${request.goalTitle}.`,
      data: {
        goalId: request.goalId,
        screen: 'wallet',
        type: 'customer_savings_reminder',
      },
    },
    trigger: buildSavingsReminderTrigger({
      frequency: request.frequency,
      notifications,
      scheduledAt: request.scheduledAt,
    }),
  });
  // The pending request is retained after scheduling so auth-change cleanup
  // can re-arm the record (clear the cancelled notificationId, keep pending)
  // instead of silently destroying the reminder on sign-out.
  await savingsReminderStorage.write({
    goalId: request.goalId,
    merchantId: scope.merchantId,
    notificationId,
    pending: request,
    userId: scope.userId,
  });
  return notificationId;
}
