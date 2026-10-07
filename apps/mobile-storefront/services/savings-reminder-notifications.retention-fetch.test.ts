import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PermissionStatus } from 'expo-notifications';
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
jest.mock('@/lib/customer-savings', () => ({
  listSavingsGoals: mockListSavingsGoals,
}));

const {
  activateDueSavingsReminderNotification,
  scheduleSavingsReminderNotification,
  suppressSavingsReminderNotification,
} =
  require('./savings-reminder-notifications') as typeof import('./savings-reminder-notifications');
const mockNotifications = require('expo-notifications') as jest.Mocked<
  typeof import('expo-notifications')
>;

function goalFixture(id: string, status: SavingsGoal['status']): SavingsGoal {
  return {
    breakFeePercent: 0,
    contributionAmount: 500,
    contributionFrequency: 'weekly',
    currentAmount: 100,
    id,
    maturityDate: '2026-12-31',
    productId: 'product-1',
    sourceMode: 'manual',
    startDate: '2026-01-01',
    status,
    targetAmount: 1000,
    title: 'Phone',
    variantId: null,
  };
}

function scheduledGoalIds(): Array<string | undefined> {
  return mockNotifications.scheduleNotificationAsync.mock.calls.map(
    (call) =>
      (call[0] as { content: { data: { goalId?: string } } }).content.data
        .goalId
  );
}

describe('savings reminder fetch gating', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthState.merchantId = '00000000-0000-4000-8000-000000000010';
    mockAuthState.user = { id: 'user-a' };
    // clearAllMocks keeps implementations: restore granted permission or the
    // denied override leaks into later tests.
    mockNotifications.getPermissionsAsync.mockResolvedValue({
      canAskAgain: true,
      expires: 'never',
      granted: true,
      status: 'granted' as PermissionStatus,
    });
    await AsyncStorage.clear();
    mockListSavingsGoals.mockResolvedValue({
      goals: [],
      summary: { activeGoalCount: 0, savingsBalance: 0 },
    });
  });

  it('retires terminal goals even when local arming is impossible', async () => {
    await scheduleSavingsReminderNotification({
      contributionAmount: 500,
      frequency: 'weekly',
      goalId: 'goal-1',
      goalTitle: 'Phone',
      scheduledAt: new Date(2020, 5, 8, 9, 30),
    });
    mockNotifications.getPermissionsAsync.mockResolvedValue({
      canAskAgain: true,
      expires: 'never',
      granted: false,
      status: 'denied' as PermissionStatus,
    });
    mockListSavingsGoals.mockResolvedValue({
      goals: [goalFixture('goal-1', 'completed')],
      summary: { activeGoalCount: 0, savingsBalance: 100 },
    });

    await activateDueSavingsReminderNotification();

    // The fetch runs for retirement (not arming): the finished goal's live
    // notification is cancelled and its record destroyed, with nothing
    // (re)scheduled while permission is revoked.
    expect(mockListSavingsGoals).toHaveBeenCalledTimes(1);
    expect(
      mockNotifications.cancelScheduledNotificationAsync
    ).toHaveBeenCalledWith('notification-id');
    expect(scheduledGoalIds()).toEqual(['goal-1']);
    await activateDueSavingsReminderNotification();
    expect(scheduledGoalIds()).toEqual(['goal-1']);
  });

  it('skips the goals fetch when no reminder records exist', async () => {
    await activateDueSavingsReminderNotification();

    expect(mockListSavingsGoals).not.toHaveBeenCalled();
  });

  it('aborts activation when the account changes mid-fetch', async () => {
    await scheduleSavingsReminderNotification({
      contributionAmount: 500,
      frequency: 'weekly',
      goalId: 'goal-1',
      goalTitle: 'Phone',
      scheduledAt: new Date(2020, 5, 8, 9, 30),
    });
    // user-b holds a due retained pending for a goal this snapshot never
    // lists; arming it unreconciled would remind for a possibly finished goal.
    mockAuthState.user = { id: 'user-b' };
    await scheduleSavingsReminderNotification({
      contributionAmount: 700,
      frequency: 'weekly',
      goalId: 'goal-9',
      goalTitle: 'Tablet',
      scheduledAt: new Date(2020, 5, 8, 9, 30),
    });
    await suppressSavingsReminderNotification();
    mockAuthState.user = { id: 'user-a' };

    let resolveGoals!: (value: GoalsResponse) => void;
    const gate = new Promise<GoalsResponse>((resolve) => {
      resolveGoals = resolve;
    });
    mockListSavingsGoals.mockReturnValueOnce(gate);
    const activation = activateDueSavingsReminderNotification();
    mockAuthState.user = { id: 'user-b' };
    resolveGoals({
      goals: [goalFixture('goal-1', 'active')],
      summary: { activeGoalCount: 1, savingsBalance: 100 },
    });
    await activation;

    // Aborted: nothing armed beyond the two initial schedules (user-b gets a
    // fresh activation with its own snapshot from the auth-change effect).
    expect(scheduledGoalIds()).toEqual(['goal-1', 'goal-9']);
    expect(mockListSavingsGoals).toHaveBeenCalledTimes(1);
  });
});
