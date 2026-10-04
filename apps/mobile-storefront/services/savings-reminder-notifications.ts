import { Platform } from 'react-native';
import { EXPO_PUBLIC_API_URL } from '@/env';
import { CONFIG } from '@/lib/config';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { createLogger } from '@/lib/logger';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { savingsNotificationCapability } from '@/services/savings-notification-capability';
import { useAuthStore } from '@/stores/auth-store';
import {
  type SavingsReminderRequest,
  savingsReminderStorage,
} from './savings-reminder-storage';

const log = createLogger('SavingsReminderNotifications');
const SAVINGS_REMINDER_CHANNEL_ID = 'savings';
type SavingsReminderFrequency = 'daily' | 'weekly' | 'monthly';
type NotificationsModule = typeof import('expo-notifications');

let Notifications: NotificationsModule | null = null;

function hasServerSavingsNotificationCapability() {
  const { merchantId, user } = useAuthStore.getState();
  const resolvedMerchantId = pickMerchantId(merchantId, CONFIG.MERCHANT_ID);
  if (!resolvedMerchantId || !user?.id) return Promise.resolve(false);
  return savingsNotificationCapability.isAvailable({
    apiOrigin: EXPO_PUBLIC_API_URL,
    merchantId: resolvedMerchantId,
    userId: user.id,
  });
}

function loadNotificationsModule() {
  if (Platform.OS === 'web') return null;
  if (Notifications) return Notifications;
  try {
    Notifications = require('expo-notifications') as NotificationsModule;
    return Notifications;
  } catch (error) {
    log.debug('Notifications module unavailable for savings reminders', error);
    return null;
  }
}

async function ensureSavingsReminderPermissions(
  notifications: NotificationsModule
) {
  const { status: existingStatus } = await notifications.getPermissionsAsync();
  if (existingStatus === 'granted') return true;
  const { status } = await notifications.requestPermissionsAsync();
  return status === 'granted';
}

async function hasSavingsReminderPermission(
  notifications: NotificationsModule
) {
  const { status } = await notifications.getPermissionsAsync();
  return status === 'granted';
}

async function ensureSavingsReminderChannel(
  notifications: NotificationsModule
) {
  if (Platform.OS !== 'android') return;
  await notifications.setNotificationChannelAsync(SAVINGS_REMINDER_CHANNEL_ID, {
    name: 'Savings Reminders',
    description: 'Reminders to keep your device savings goal on track',
    importance: notifications.AndroidImportance.DEFAULT,
  });
}

function buildSavingsReminderTrigger({
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

async function cancelStoredSavingsReminderNotification(
  notifications: NotificationsModule | null,
  goalId?: string
) {
  let removed = false;
  for (const record of await savingsReminderStorage.read(goalId)) {
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
    await savingsReminderStorage.remove(record.goalId);
  }
  return removed;
}

async function scheduleRecurringSavingsReminder({
  notifications,
  request,
}: {
  notifications: NotificationsModule;
  request: SavingsReminderRequest;
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
  await savingsReminderStorage.write({
    goalId: request.goalId,
    notificationId,
  });
  return notificationId;
}

export function cancelSavingsReminderNotification(goalId?: string) {
  return savingsReminderStorage.runExclusive(() =>
    cancelStoredSavingsReminderNotification(loadNotificationsModule(), goalId)
  );
}

export function activateDueSavingsReminderNotification() {
  return savingsReminderStorage.runExclusive(activateDueReminders);
}

async function activateDueReminders() {
  if (await hasServerSavingsNotificationCapability()) {
    await cancelStoredSavingsReminderNotification(loadNotificationsModule());
    return null;
  }
  const records = await savingsReminderStorage.read();
  const due = records.filter(
    ({ pending }) => pending && pending.scheduledAt.getTime() <= Date.now()
  );
  if (!due.length) return null;
  const notifications = loadNotificationsModule();
  if (!notifications || !(await hasSavingsReminderPermission(notifications)))
    return null;
  await ensureSavingsReminderChannel(notifications);
  let notificationId: string | null = null;
  let failure: unknown;
  for (const { pending } of due) {
    if (!pending) continue;
    try {
      notificationId = await scheduleRecurringSavingsReminder({
        notifications,
        request: pending,
      });
    } catch (error) {
      failure = error;
    }
  }
  if (failure) throw failure;
  return notificationId;
}

export function scheduleSavingsReminderNotification({
  contributionAmount,
  frequency,
  goalId,
  goalTitle,
  scheduledAt = new Date(),
}: {
  contributionAmount: number;
  frequency: SavingsReminderFrequency;
  goalId: string;
  goalTitle: string;
  scheduledAt?: Date;
}): Promise<string | null> {
  return savingsReminderStorage.runExclusive(() =>
    scheduleReminder({
      contributionAmount,
      frequency,
      goalId,
      goalTitle,
      scheduledAt,
    })
  );
}

async function scheduleReminder(
  request: SavingsReminderRequest
): Promise<string | null> {
  if (await hasServerSavingsNotificationCapability()) {
    await cancelStoredSavingsReminderNotification(loadNotificationsModule());
    return null;
  }
  const notifications = loadNotificationsModule();
  if (
    !notifications ||
    !(await ensureSavingsReminderPermissions(notifications))
  )
    return null;
  await ensureSavingsReminderChannel(notifications);
  await cancelStoredSavingsReminderNotification(notifications, request.goalId);
  const [remaining] = await savingsReminderStorage.read(request.goalId);
  if (remaining.notificationId) return null;
  if (request.scheduledAt.getTime() > Date.now()) {
    await savingsReminderStorage.write({
      goalId: request.goalId,
      pending: request,
    });
    return null;
  }
  return await scheduleRecurringSavingsReminder({ notifications, request });
}
