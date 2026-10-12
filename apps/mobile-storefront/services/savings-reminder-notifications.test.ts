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
const mockAuthState: {
  merchantId: string | null;
  user: { id: string } | null;
} = {
  merchantId: '00000000-0000-4000-8000-000000000010',
  user: { id: 'user-a' },
};
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => mockAuthState },
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
  cancelSavingsReminderNotification,
  scheduleSavingsReminderNotification,
} =
  require('./savings-reminder-notifications') as typeof import('./savings-reminder-notifications');

describe('savings reminder scheduling and cancellation', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockAuthState.merchantId = '00000000-0000-4000-8000-000000000010';
    mockAuthState.user = { id: 'user-a' };
    await AsyncStorage.clear();
  });

  it('keeps the first goal reminder when a second goal is scheduled and cancels only the requested goal', async () => {
    mockScheduleNotificationAsync
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second');
    for (const goalId of ['goal-1', 'goal-2']) {
      await scheduleSavingsReminderNotification({
        contributionAmount: 500,
        frequency: 'weekly',
        goalId,
        goalTitle: 'Phone',
      });
    }
    expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalled();
    await cancelSavingsReminderNotification('goal-2');
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('second');
    expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalledWith(
      'first'
    );
    await cancelSavingsReminderNotification();
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('first');
  });

  it('cancels the captured scope when auth changed before the queued cancel runs', async () => {
    mockScheduleNotificationAsync.mockResolvedValueOnce('user-a-live');
    await scheduleSavingsReminderNotification({
      contributionAmount: 500,
      frequency: 'weekly',
      goalId: 'goal-1',
      goalTitle: 'Phone',
    });
    // user-b signs in and schedules before the queued cancel runs.
    mockAuthState.user = { id: 'user-b' };
    mockScheduleNotificationAsync.mockResolvedValueOnce('user-b-live');
    await scheduleSavingsReminderNotification({
      contributionAmount: 500,
      frequency: 'weekly',
      goalId: 'goal-9',
      goalTitle: 'Tablet',
    });

    await cancelSavingsReminderNotification(undefined, {
      merchantId: '00000000-0000-4000-8000-000000000010',
      userId: 'user-a',
    });

    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith(
      'user-a-live'
    );
    expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalledWith(
      'user-b-live'
    );
    await expect(
      AsyncStorage.getItem(
        'baci:savings-reminder-goal:user-b:00000000-0000-4000-8000-000000000010:goal-9'
      )
    ).resolves.toContain('user-b-live');
  });

  it('clears scheduled and pending goals for cancel-all', async () => {
    await scheduleSavingsReminderNotification({
      contributionAmount: 500,
      frequency: 'weekly',
      goalId: 'goal-1',
      goalTitle: 'Phone',
    });
    await scheduleSavingsReminderNotification({
      contributionAmount: 500,
      frequency: 'weekly',
      goalId: 'goal-2',
      goalTitle: 'Phone',
      scheduledAt: new Date(2099, 0, 1),
    });
    await cancelSavingsReminderNotification();
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(
      (await AsyncStorage.getAllKeys()).filter((key) =>
        key.startsWith('baci:savings-reminder-')
      )
    ).toEqual([]);
  });

  it('does not request permission while activating a due local reminder', async () => {
    // Pre-scope legacy keys are disposed, never adopted: seed a scoped
    // pending record through the public API instead.
    await scheduleSavingsReminderNotification({
      contributionAmount: 500,
      frequency: 'weekly',
      goalId: 'goal-1',
      goalTitle: 'Phone',
      scheduledAt: new Date(2099, 0, 1),
    });
    mockGetPermissionsAsync.mockResolvedValue({ status: 'denied' });
    const now = jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date(2100, 0, 1).getTime());
    try {
      await expect(
        activateDueSavingsReminderNotification()
      ).resolves.toBeNull();
    } finally {
      now.mockRestore();
    }

    await expect(
      AsyncStorage.getItem(
        'baci:savings-reminder-goal:user-a:00000000-0000-4000-8000-000000000010:goal-1'
      )
    ).resolves.toContain('goal-1');
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('retains a failed cancellation for retry without creating a duplicate', async () => {
    const request = {
      contributionAmount: 500,
      frequency: 'weekly' as const,
      goalId: 'goal-1',
      goalTitle: 'Phone',
    };
    await scheduleSavingsReminderNotification(request);
    mockCancelScheduledNotificationAsync.mockRejectedValueOnce(
      new Error('native failure')
    );
    await expect(
      scheduleSavingsReminderNotification(request)
    ).resolves.toBeNull();
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
    await expect(cancelSavingsReminderNotification('goal-1')).resolves.toBe(
      true
    );
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledTimes(2);
  });

  it('fails closed when no account is signed in', async () => {
    mockAuthState.user = null;

    await expect(
      scheduleSavingsReminderNotification({
        contributionAmount: 500,
        frequency: 'weekly',
        goalId: 'goal-1',
        goalTitle: 'Phone',
      })
    ).resolves.toBeNull();
    await expect(activateDueSavingsReminderNotification()).resolves.toBeNull();
    await expect(cancelSavingsReminderNotification('goal-1')).resolves.toBe(
      false
    );
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  it('cancels the native notification when persistence fails', async () => {
    const setItem = jest
      .spyOn(AsyncStorage, 'setItem')
      .mockRejectedValueOnce(new Error('disk full'));
    try {
      await expect(
        scheduleSavingsReminderNotification({
          contributionAmount: 500,
          frequency: 'weekly',
          goalId: 'goal-1',
          goalTitle: 'Phone',
        })
      ).rejects.toThrow('disk full');
    } finally {
      setItem.mockRestore();
    }
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith(
      'notification-id'
    );
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });
});
