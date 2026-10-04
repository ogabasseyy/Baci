import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockCancelScheduledNotificationAsync = jest.fn(async () => undefined);
const mockGetPermissionsAsync = jest.fn(async () => ({ status: 'granted' }));
const mockRequestPermissionsAsync = jest.fn(async () => ({
  status: 'granted',
}));
const mockScheduleNotificationAsync = jest.fn(async () => 'notification-id');
const mockSetNotificationChannelAsync = jest.fn(async () => undefined);

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 'default' },
  SchedulableTriggerInputTypes: { WEEKLY: 'weekly' },
  cancelScheduledNotificationAsync: mockCancelScheduledNotificationAsync,
  getPermissionsAsync: mockGetPermissionsAsync,
  requestPermissionsAsync: mockRequestPermissionsAsync,
  scheduleNotificationAsync: mockScheduleNotificationAsync,
  setNotificationChannelAsync: mockSetNotificationChannelAsync,
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

const {
  activateDueSavingsReminderNotification,
  scheduleSavingsReminderNotification,
} =
  require('./savings-reminder-notifications') as typeof import('./savings-reminder-notifications');
const { savingsNotificationCapability } =
  require('./savings-notification-capability') as typeof import('./savings-notification-capability');

describe('savings reminder notification capability', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('keeps legacy local reminders active before the inbox capability is established', async () => {
    await Promise.all([
      AsyncStorage.setItem(
        'baci:savings-reminder-notification-id',
        'legacy-reminder'
      ),
      AsyncStorage.setItem('baci:savings-reminder-goal-id', 'goal-1'),
    ]);

    await expect(
      scheduleSavingsReminderNotification({
        contributionAmount: 500,
        frequency: 'weekly',
        goalId: 'goal-1',
        goalTitle: 'Phone',
      })
    ).resolves.toBe('notification-id');

    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith(
      'legacy-reminder'
    );
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mockGetPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('retires stale device reminders only after an authenticated inbox capability success', async () => {
    await Promise.all([
      AsyncStorage.setItem(
        'baci:savings-reminder-notification-id',
        'legacy-reminder'
      ),
      AsyncStorage.setItem('baci:savings-reminder-goal-id', 'goal-1'),
    ]);

    await savingsNotificationCapability.markAvailable({
      apiOrigin: 'https://api.baci.test',
      merchantId: '00000000-0000-4000-8000-000000000010',
      userId: 'user-a',
    });

    expect(mockGetPermissionsAsync).not.toHaveBeenCalled();
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();

    await expect(
      scheduleSavingsReminderNotification({
        contributionAmount: 500,
        frequency: 'weekly',
        goalId: 'goal-1',
        goalTitle: 'Phone',
      })
    ).resolves.toBeNull();
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith(
      'legacy-reminder'
    );
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does not request permission while activating a due local reminder', async () => {
    await AsyncStorage.setItem(
      'baci:savings-reminder-pending-request',
      JSON.stringify({
        contributionAmount: 500,
        frequency: 'weekly',
        goalId: 'goal-1',
        goalTitle: 'Phone',
        scheduledAt: new Date(2020, 5, 8, 9, 30).toISOString(),
      })
    );
    mockGetPermissionsAsync.mockResolvedValue({ status: 'denied' });

    await expect(activateDueSavingsReminderNotification()).resolves.toBeNull();

    await expect(
      AsyncStorage.getItem('baci:savings-reminder-pending-request')
    ).resolves.toContain('goal-1');
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
  });
});
