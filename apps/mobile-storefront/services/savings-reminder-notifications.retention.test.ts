import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SavingsGoal } from '@/schemas/customer-savings';

type GoalsResponse = {
  goals: SavingsGoal[];
  summary: { activeGoalCount: number; savingsBalance: number };
};

const mockListSavingsGoals = jest.fn<() => Promise<GoalsResponse>>();

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
jest.mock('@/lib/customer-savings', () => ({
  listSavingsGoals: mockListSavingsGoals,
}));

const {
  activateDueSavingsReminderNotification,
  scheduleSavingsReminderNotification,
} =
  require('./savings-reminder-notifications') as typeof import('./savings-reminder-notifications');
const { savingsNotificationCapability } =
  require('./savings-notification-capability') as typeof import('./savings-notification-capability');
const mockNotifications = require('expo-notifications') as jest.Mocked<
  typeof import('expo-notifications')
>;

const merchantId = '00000000-0000-4000-8000-000000000010';
const capabilityScope = {
  apiOrigin: 'https://api.baci.test',
  merchantId,
  userId: 'user-a',
};

function scheduledGoalIds(): Array<string | undefined> {
  return mockNotifications.scheduleNotificationAsync.mock.calls.map(
    (call) =>
      (call[0] as { content: { data: { goalId?: string } } }).content.data
        .goalId
  );
}

describe('savings reminder retention across server-delivery transitions', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockListSavingsGoals.mockResolvedValue({
      goals: [],
      summary: { activeGoalCount: 0, savingsBalance: 0 },
    });
  });

  it('re-arms retained pendings after server delivery is enabled and then lost', async () => {
    await scheduleSavingsReminderNotification({
      contributionAmount: 500,
      frequency: 'weekly',
      goalId: 'goal-1',
      goalTitle: 'Phone',
      scheduledAt: new Date(2020, 5, 8, 9, 30),
    });
    expect(scheduledGoalIds()).toEqual(['goal-1']);

    await savingsNotificationCapability.markAvailable(capabilityScope);
    await activateDueSavingsReminderNotification();

    // Live OS notification cancelled, but nothing re-scheduled while the
    // server owns delivery — and the pending request must survive.
    expect(
      mockNotifications.cancelScheduledNotificationAsync
    ).toHaveBeenCalledWith('notification-id');
    expect(scheduledGoalIds()).toEqual(['goal-1']);

    await savingsNotificationCapability.clearAvailable(capabilityScope);
    await activateDueSavingsReminderNotification();

    expect(scheduledGoalIds()).toEqual(['goal-1', 'goal-1']);
  });

  it('persists new requests scheduled while capability is available', async () => {
    await scheduleSavingsReminderNotification({
      contributionAmount: 500,
      frequency: 'weekly',
      goalId: 'goal-1',
      goalTitle: 'Phone',
      scheduledAt: new Date(2020, 5, 8, 9, 30),
    });

    await savingsNotificationCapability.markAvailable(capabilityScope);
    // No live schedule while the server owns delivery — but the request is
    // persisted as a pending so a later rollback can re-arm it.
    await expect(
      scheduleSavingsReminderNotification({
        contributionAmount: 700,
        frequency: 'weekly',
        goalId: 'goal-2',
        goalTitle: 'Laptop',
      })
    ).resolves.toBeNull();

    await savingsNotificationCapability.clearAvailable(capabilityScope);
    await activateDueSavingsReminderNotification();

    expect(scheduledGoalIds()).toHaveLength(3);
    expect(scheduledGoalIds().filter((id) => id === 'goal-1')).toHaveLength(2);
    expect(scheduledGoalIds()).toContain('goal-2');
  });

  it('preserves the live notification ID when suppression fails during a server-owned update', async () => {
    await scheduleSavingsReminderNotification({
      contributionAmount: 500,
      frequency: 'weekly',
      goalId: 'goal-1',
      goalTitle: 'Phone',
      scheduledAt: new Date(2020, 5, 8, 9, 30),
    });
    await savingsNotificationCapability.markAvailable(capabilityScope);
    mockNotifications.cancelScheduledNotificationAsync.mockRejectedValueOnce(
      new Error('os busy')
    );

    await scheduleSavingsReminderNotification({
      contributionAmount: 700,
      frequency: 'weekly',
      goalId: 'goal-1',
      goalTitle: 'Phone',
    });

    const { savingsReminderStorage } =
      require('./savings-reminder-storage') as typeof import('./savings-reminder-storage');
    const { buildReminderScope } =
      require('./savings-reminder-notifications') as typeof import('./savings-reminder-notifications');
    const scope = buildReminderScope('user-a', merchantId);
    if (!scope) throw new Error('test scope must resolve');
    const [record] = await savingsReminderStorage.read(scope, 'goal-1');
    // The live ID survives (the OS notification is still real) while the
    // pending carries the updated request.
    expect(record.notificationId).toBe('notification-id');
    expect(record.pending?.contributionAmount).toBe(700);
  });
});
