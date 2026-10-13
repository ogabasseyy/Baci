import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 'default' },
  SchedulableTriggerInputTypes: {
    DAILY: 'daily',
    MONTHLY: 'monthly',
    WEEKLY: 'weekly',
  },
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  scheduleNotificationAsync: jest.fn(async () => 'notification-id'),
  setNotificationChannelAsync: jest.fn(async () => null),
}));
jest.mock('@/lib/storage', () => {
  const storage = require('@react-native-async-storage/async-storage');
  return { asyncStorage: storage.default ?? storage };
});
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: jest.fn() }),
}));
jest.mock('@/env', () => ({ EXPO_PUBLIC_API_URL: 'https://api.baci.test' }));
jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: '00000000-0000-4000-8000-000000000010' },
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({
      merchantId: '00000000-0000-4000-8000-000000000010',
      user: { id: 'user-a' },
    }),
  },
}));
// Goal reconciliation is covered in the retention suite; here it resolves no
// goals so every record is kept (and the API-client graph stays unloaded).
jest.mock('@/lib/customer-savings', () => ({
  listSavingsGoals: jest.fn(async () => ({
    goals: [],
    summary: { activeGoalCount: 0, savingsBalance: 0 },
  })),
}));

const {
  activateDueSavingsReminderNotification,
  scheduleSavingsReminderNotification,
} =
  require('./savings-reminder-notifications') as typeof import('./savings-reminder-notifications');
const mockNotifications = require('expo-notifications') as jest.Mocked<
  typeof import('expo-notifications')
>;

describe('scheduleSavingsReminderNotification triggers', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('uses a calendar-aware monthly trigger before the server inbox is available', async () => {
    await scheduleSavingsReminderNotification({
      contributionAmount: 500,
      frequency: 'monthly',
      goalId: 'goal-1',
      goalTitle: 'iPhone 15 Pro',
      scheduledAt: new Date(2020, 5, 8, 9, 30),
    });

    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: {
          channelId: 'savings',
          day: 8,
          hour: 9,
          minute: 30,
          type: 'monthly',
        },
      })
    );
  });

  it('clamps month-end monthly triggers to the 28th so short months still fire', async () => {
    await scheduleSavingsReminderNotification({
      contributionAmount: 500,
      frequency: 'monthly',
      goalId: 'goal-1',
      goalTitle: 'iPhone 15 Pro',
      scheduledAt: new Date(2020, 0, 31, 9, 30),
    });

    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: {
          channelId: 'savings',
          day: 28,
          hour: 9,
          minute: 30,
          type: 'monthly',
        },
      })
    );
  });

  it('activates a due reminder without prompting when permission was already granted', async () => {
    // Pre-scope legacy keys are disposed, never adopted: seed a scoped
    // pending record through the public API instead (frozen clock makes the
    // fixed scheduledAt future at schedule time, due at activation time).
    const scheduledAt = new Date(2020, 5, 8, 9, 30);
    const scheduleNow = jest
      .spyOn(Date, 'now')
      .mockReturnValue(scheduledAt.getTime() - 1000);
    try {
      await scheduleSavingsReminderNotification({
        contributionAmount: 500,
        frequency: 'weekly',
        goalId: 'goal-1',
        goalTitle: 'iPhone 15 Pro',
        scheduledAt,
      });
    } finally {
      scheduleNow.mockRestore();
    }
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();

    await expect(activateDueSavingsReminderNotification()).resolves.toBe(
      'notification-id'
    );

    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: {
          channelId: 'savings',
          hour: 9,
          minute: 30,
          type: 'weekly',
          weekday: 2,
        },
      })
    );
  });
});
