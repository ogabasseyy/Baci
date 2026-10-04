import { Platform } from 'react-native';
import { EXPO_PUBLIC_API_URL } from '@/env';
import { CONFIG } from '@/lib/config';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { createLogger } from '@/lib/logger';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { asyncStorage as AsyncStorage } from '@/lib/storage';
import { savingsNotificationCapability } from '@/services/savings-notification-capability';
import { useAuthStore } from '@/stores/auth-store';

const log = createLogger('SavingsReminderNotifications');
const SAVINGS_REMINDER_CHANNEL_ID = 'savings';
const SAVINGS_REMINDER_NOTIFICATION_ID_KEY =
  'baci:savings-reminder-notification-id';
const SAVINGS_REMINDER_GOAL_ID_KEY = 'baci:savings-reminder-goal-id';
const SAVINGS_REMINDER_PENDING_REQUEST_KEY =
  'baci:savings-reminder-pending-request';
type SavingsReminderFrequency = 'daily' | 'weekly' | 'monthly';
type NotificationsModule = typeof import('expo-notifications');
type SavingsReminderRequest = {
  contributionAmount: number;
  frequency: SavingsReminderFrequency;
  goalId: string;
  goalTitle: string;
  scheduledAt: Date;
};

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

function parseStoredSavingsReminderRequest(
  value: string | null
): SavingsReminderRequest | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<
      Omit<SavingsReminderRequest, 'scheduledAt'> & { scheduledAt: string }
    >;
    const scheduledAt =
      typeof parsed.scheduledAt === 'string'
        ? new Date(parsed.scheduledAt)
        : null;
    if (
      typeof parsed.contributionAmount !== 'number' ||
      !Number.isFinite(parsed.contributionAmount) ||
      (parsed.frequency !== 'daily' &&
        parsed.frequency !== 'weekly' &&
        parsed.frequency !== 'monthly') ||
      typeof parsed.goalId !== 'string' ||
      typeof parsed.goalTitle !== 'string' ||
      !scheduledAt ||
      Number.isNaN(scheduledAt.getTime())
    )
      return null;
    return {
      contributionAmount: parsed.contributionAmount,
      frequency: parsed.frequency,
      goalId: parsed.goalId,
      goalTitle: parsed.goalTitle,
      scheduledAt,
    };
  } catch {
    return null;
  }
}

async function storePendingSavingsReminderRequest(
  request: SavingsReminderRequest
) {
  await AsyncStorage.setItem(
    SAVINGS_REMINDER_PENDING_REQUEST_KEY,
    JSON.stringify({
      ...request,
      scheduledAt: request.scheduledAt.toISOString(),
    })
  );
}

async function removePendingSavingsReminderRequest(goalId?: string) {
  const storedRequest = parseStoredSavingsReminderRequest(
    await AsyncStorage.getItem(SAVINGS_REMINDER_PENDING_REQUEST_KEY)
  );
  if (!storedRequest) {
    await AsyncStorage.removeItem(SAVINGS_REMINDER_PENDING_REQUEST_KEY);
    return false;
  }
  if (goalId && storedRequest.goalId !== goalId) return false;
  await AsyncStorage.removeItem(SAVINGS_REMINDER_PENDING_REQUEST_KEY);
  return true;
}

async function cancelStoredSavingsReminderNotification(
  notifications: NotificationsModule,
  goalId?: string
) {
  const removedPendingRequest =
    await removePendingSavingsReminderRequest(goalId);
  const [storedNotificationId, storedGoalId] = await Promise.all([
    AsyncStorage.getItem(SAVINGS_REMINDER_NOTIFICATION_ID_KEY),
    AsyncStorage.getItem(SAVINGS_REMINDER_GOAL_ID_KEY),
  ]);
  if (!storedNotificationId) return removedPendingRequest;
  if (goalId && storedGoalId && storedGoalId !== goalId)
    return removedPendingRequest;
  try {
    await notifications.cancelScheduledNotificationAsync(storedNotificationId);
  } catch (error) {
    log.debug('Unable to cancel stored savings reminder notification', error);
  }
  await Promise.all([
    AsyncStorage.removeItem(SAVINGS_REMINDER_NOTIFICATION_ID_KEY),
    AsyncStorage.removeItem(SAVINGS_REMINDER_GOAL_ID_KEY),
  ]);
  return true;
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
  await Promise.all([
    AsyncStorage.setItem(SAVINGS_REMINDER_NOTIFICATION_ID_KEY, notificationId),
    AsyncStorage.setItem(SAVINGS_REMINDER_GOAL_ID_KEY, request.goalId),
  ]);
  return notificationId;
}

export async function cancelSavingsReminderNotification(goalId?: string) {
  const notifications = loadNotificationsModule();
  if (!notifications) return false;
  return await cancelStoredSavingsReminderNotification(notifications, goalId);
}

export async function activateDueSavingsReminderNotification() {
  if (await hasServerSavingsNotificationCapability()) {
    await cancelSavingsReminderNotification();
    return null;
  }
  const request = parseStoredSavingsReminderRequest(
    await AsyncStorage.getItem(SAVINGS_REMINDER_PENDING_REQUEST_KEY)
  );
  if (!request) {
    await AsyncStorage.removeItem(SAVINGS_REMINDER_PENDING_REQUEST_KEY);
    return null;
  }
  if (request.scheduledAt.getTime() > Date.now()) return null;
  const notifications = loadNotificationsModule();
  if (!notifications || !(await hasSavingsReminderPermission(notifications)))
    return null;
  await ensureSavingsReminderChannel(notifications);
  const notificationId = await scheduleRecurringSavingsReminder({
    notifications,
    request,
  });
  await AsyncStorage.removeItem(SAVINGS_REMINDER_PENDING_REQUEST_KEY);
  return notificationId;
}

export async function scheduleSavingsReminderNotification({
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
  if (await hasServerSavingsNotificationCapability()) {
    await cancelSavingsReminderNotification();
    return null;
  }
  const notifications = loadNotificationsModule();
  if (
    !notifications ||
    !(await ensureSavingsReminderPermissions(notifications))
  )
    return null;
  await ensureSavingsReminderChannel(notifications);
  await cancelStoredSavingsReminderNotification(notifications);
  const request = {
    contributionAmount,
    frequency,
    goalId,
    goalTitle,
    scheduledAt,
  };
  if (scheduledAt.getTime() > Date.now()) {
    await storePendingSavingsReminderRequest(request);
    return null;
  }
  await removePendingSavingsReminderRequest();
  return await scheduleRecurringSavingsReminder({ notifications, request });
}
