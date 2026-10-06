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
  // Expo monthly triggers fire only when the day matches, so a 29th/30th/
  // 31st start would silently skip short months. Clamp to the 28th — every
  // month has one — so the local fallback always fires; a slightly early
  // reminder beats a missed one.
  return {
    ...shared,
    day: Math.min(scheduledAt.getDate(), 28),
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
 * Server-delivery suppression: cancels live OS notifications but retains
 * the pending requests (re-armed records keep `pending` with a cleared
 * `notificationId`) so local reminders resume if server delivery is later
 * rolled back. Unlike cancelStoredSavingsReminderNotification, nothing is
 * removed. When the OS cancel cannot be confirmed the stored ID is kept
 * for a later retry — otherwise the live notification fires under the
 * next account.
 */
export async function suppressStoredSavingsReminderNotification(
  notifications: NotificationsModule | null,
  scope: SavingsReminderScope,
  goalId?: string
) {
  let suppressed = false;
  for (const record of await savingsReminderStorage.read(scope, goalId)) {
    if (record.notificationId) {
      if (!notifications) continue;
      try {
        await notifications.cancelScheduledNotificationAsync(
          record.notificationId
        );
      } catch (error) {
        log.debug(
          'Unable to suppress stored savings reminder notification',
          error
        );
        continue;
      }
      suppressed = true;
    }
    suppressed ||= Boolean(record.pending);
    await savingsReminderStorage.write({
      ...record,
      notificationId: undefined,
    });
  }
  return suppressed;
}

/**
 * One-way disposal of pre-scope records. Unscoped state cannot be attributed
 * to the current account, so any live OS notification is cancelled and the
 * entry dropped — never adopted. Entries are retained until cancellation is
 * confirmed (or there is nothing live to cancel), so a failed cancel can be
 * retried on a later run instead of orphaning the OS notification. Runs at
 * every entry point (idempotent).
 */
export async function disposeUnscopedSavingsReminders(
  notifications: NotificationsModule | null
) {
  for (const entry of await savingsReminderStorage.readUnscoped()) {
    const notificationId = entry.record?.notificationId;
    if (!notificationId) {
      await savingsReminderStorage.removeUnscoped(entry.keys);
      continue;
    }
    if (!notifications) continue;
    try {
      await notifications.cancelScheduledNotificationAsync(notificationId);
    } catch (error) {
      log.debug(
        'Unable to cancel unscoped savings reminder notification',
        error
      );
      continue;
    }
    await savingsReminderStorage.removeUnscoped(entry.keys);
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
  try {
    await savingsReminderStorage.write({
      goalId: request.goalId,
      merchantId: scope.merchantId,
      notificationId,
      pending: request,
      userId: scope.userId,
    });
  } catch (error) {
    // The write holds the only copy of notificationId: without a rollback
    // the native notification is orphaned — retries duplicate it and
    // account cleanup can never cancel it, so it fires across sign-out.
    // Cancel the just-created notification before rethrowing.
    try {
      await notifications.cancelScheduledNotificationAsync(notificationId);
    } catch (cancelError) {
      log.debug(
        'Unable to roll back savings reminder after persistence failure',
        cancelError
      );
    }
    throw error;
  }
  return notificationId;
}
