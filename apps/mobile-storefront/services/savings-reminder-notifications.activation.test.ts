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
  scheduleSavingsReminderNotification,
  suppressSavingsReminderNotification,
} =
  require('./savings-reminder-notifications') as typeof import('./savings-reminder-notifications');
const { savingsNotificationCapability } =
  require('./savings-notification-capability') as typeof import('./savings-notification-capability');

describe('savings reminder activation and server capability', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockAuthState.merchantId = '00000000-0000-4000-8000-000000000010';
    mockAuthState.user = { id: 'user-a' };
    await AsyncStorage.clear();
  });

  it('activates both pending goals on boot without replacing the first', async () => {
    for (const goalId of ['goal-1', 'goal-2']) {
      await scheduleSavingsReminderNotification({
        contributionAmount: 500,
        frequency: 'weekly',
        goalId,
        goalTitle: 'Phone',
        scheduledAt: new Date(2099, 0, 1),
      });
    }
    const now = jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date(2100, 0, 1).getTime());
    try {
      await activateDueSavingsReminderNotification();
      expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(2);
      expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  it('retains pendings while cancelling live notifications for server-push', async () => {
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
    await savingsNotificationCapability.markAvailable({
      apiOrigin: 'https://api.baci.test',
      merchantId: '00000000-0000-4000-8000-000000000010',
      userId: 'user-a',
    });
    await activateDueSavingsReminderNotification();
    // The live OS notification is cancelled, but both pendings survive so
    // local reminders re-arm if server delivery is later lost.
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(
      (await AsyncStorage.getAllKeys())
        .filter((key) => key.startsWith('baci:savings-reminder-goal:'))
        .sort()
    ).toEqual([
      'baci:savings-reminder-goal:user-a:00000000-0000-4000-8000-000000000010:goal-1',
      'baci:savings-reminder-goal:user-a:00000000-0000-4000-8000-000000000010:goal-2',
    ]);
    await expect(
      AsyncStorage.getItem(
        'baci:savings-reminder-goal:user-a:00000000-0000-4000-8000-000000000010:goal-1'
      )
    ).resolves.toContain('Phone');
  });

  it('serializes overlapping activations so each due goal is scheduled once', async () => {
    await scheduleSavingsReminderNotification({
      contributionAmount: 500,
      frequency: 'weekly',
      goalId: 'goal-1',
      goalTitle: 'Phone',
      scheduledAt: new Date(2099, 0, 1),
    });
    const now = jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date(2100, 0, 1).getTime());
    try {
      await Promise.all([
        activateDueSavingsReminderNotification(),
        activateDueSavingsReminderNotification(),
      ]);
      expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
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

  it('suppresses live reminders while retaining pendings for a later rollback', async () => {
    await scheduleSavingsReminderNotification({
      contributionAmount: 500,
      frequency: 'weekly',
      goalId: 'goal-1',
      goalTitle: 'Phone',
    });
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);

    await expect(suppressSavingsReminderNotification()).resolves.toBe(true);
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith(
      'notification-id'
    );
    const key =
      'baci:savings-reminder-goal:user-a:00000000-0000-4000-8000-000000000010:goal-1';
    const suppressed = JSON.parse(
      (await AsyncStorage.getItem(key)) ?? '{}'
    ) as Record<string, unknown>;
    expect(suppressed.notificationId).toBeUndefined();
    expect(suppressed.pending).toEqual(
      expect.objectContaining({ goalId: 'goal-1' })
    );

    // Rollback path: activation re-arms the retained pending request.
    mockScheduleNotificationAsync.mockResolvedValueOnce('rearmed-id');
    await expect(activateDueSavingsReminderNotification()).resolves.toBe(
      'rearmed-id'
    );
  });
});
