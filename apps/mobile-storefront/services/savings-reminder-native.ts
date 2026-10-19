import { Platform } from 'react-native';
import { createLogger } from '@/lib/logger';
import {
  type NotificationsModule,
  SAVINGS_REMINDER_CHANNEL_ID,
} from './savings-reminder-scheduling';

const log = createLogger('SavingsReminderNative');

let Notifications: NotificationsModule | null = null;

export function loadNotificationsModule() {
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

export async function ensureSavingsReminderPermissions(
  notifications: NotificationsModule
) {
  const { status: existingStatus } = await notifications.getPermissionsAsync();
  if (existingStatus === 'granted') return true;
  const { status } = await notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function hasSavingsReminderPermission(
  notifications: NotificationsModule
) {
  const { status } = await notifications.getPermissionsAsync();
  return status === 'granted';
}

export async function ensureSavingsReminderChannel(
  notifications: NotificationsModule
) {
  if (Platform.OS !== 'android') return;
  await notifications.setNotificationChannelAsync(SAVINGS_REMINDER_CHANNEL_ID, {
    name: 'Savings Reminders',
    description: 'Reminders to keep your device savings goal on track',
    importance: notifications.AndroidImportance.DEFAULT,
  });
}
