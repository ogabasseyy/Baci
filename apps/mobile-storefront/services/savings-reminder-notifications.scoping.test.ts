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
  buildReminderScope,
  cancelSavingsReminderNotification,
  cancelScopeSavingsReminders,
  scheduleSavingsReminderNotification,
} =
  require('./savings-reminder-notifications') as typeof import('./savings-reminder-notifications');

describe('savings reminder auth scoping and cleanup', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockAuthState.merchantId = '00000000-0000-4000-8000-000000000010';
    mockAuthState.user = { id: 'user-a' };
    await AsyncStorage.clear();
  });

  it('never activates or cancels another account’s scoped reminders', async () => {
    mockScheduleNotificationAsync.mockResolvedValueOnce('user-a-live');
    await scheduleSavingsReminderNotification({
      contributionAmount: 500,
      frequency: 'weekly',
      goalId: 'goal-1',
      goalTitle: 'Phone',
    });
    mockAuthState.user = { id: 'user-b' };

    await expect(activateDueSavingsReminderNotification()).resolves.toBeNull();
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
    await cancelSavingsReminderNotification('goal-1');
    expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalledWith(
      'user-a-live'
    );
    // user-a's record is untouched and still keyed to its own scope.
    await expect(
      AsyncStorage.getItem(
        'baci:savings-reminder-goal:user-a:00000000-0000-4000-8000-000000000010:goal-1'
      )
    ).resolves.toContain('user-a-live');
  });

  it('cancels pre-scope OS notifications and drops the records without adopting them', async () => {
    await AsyncStorage.setItem(
      'baci:savings-reminder-goal:goal-old',
      JSON.stringify({ notificationId: 'legacy-live' })
    );

    await scheduleSavingsReminderNotification({
      contributionAmount: 500,
      frequency: 'weekly',
      goalId: 'goal-1',
      goalTitle: 'Phone',
    });

    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith(
      'legacy-live'
    );
    await expect(
      AsyncStorage.getItem('baci:savings-reminder-goal:goal-old')
    ).resolves.toBeNull();
    // The legacy goal was not adopted into the current scope.
    expect(await AsyncStorage.getAllKeys()).toEqual([
      'baci:savings-reminder-goal:user-a:00000000-0000-4000-8000-000000000010:goal-1',
    ]);
  });

  it('retains pre-scope records when native cancellation fails so a later run can retry', async () => {
    await AsyncStorage.setItem(
      'baci:savings-reminder-goal:goal-old',
      JSON.stringify({ notificationId: 'legacy-live' })
    );
    mockCancelScheduledNotificationAsync.mockRejectedValueOnce(
      new Error('notifications unavailable')
    );

    await scheduleSavingsReminderNotification({
      contributionAmount: 500,
      frequency: 'weekly',
      goalId: 'goal-1',
      goalTitle: 'Phone',
    });

    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith(
      'legacy-live'
    );
    // The cancellation ID survives the failure — the live OS notification
    // is still reachable for the next entry-point run.
    await expect(
      AsyncStorage.getItem('baci:savings-reminder-goal:goal-old')
    ).resolves.toContain('legacy-live');

    await scheduleSavingsReminderNotification({
      contributionAmount: 500,
      frequency: 'weekly',
      goalId: 'goal-1',
      goalTitle: 'Phone',
    });

    await expect(
      AsyncStorage.getItem('baci:savings-reminder-goal:goal-old')
    ).resolves.toBeNull();
  });

  it('retires a prior scope’s live notifications and re-arms them for sign-back-in', async () => {
    mockScheduleNotificationAsync.mockResolvedValueOnce('prior-live');
    await scheduleSavingsReminderNotification({
      contributionAmount: 500,
      frequency: 'weekly',
      goalId: 'goal-1',
      goalTitle: 'Phone',
    });
    const scope = buildReminderScope(
      'user-a',
      '00000000-0000-4000-8000-000000000010'
    );
    expect(scope).not.toBeNull();
    if (!scope) throw new Error('expected a reminder scope');

    await expect(cancelScopeSavingsReminders(scope)).resolves.toBe(true);
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith(
      'prior-live'
    );

    // Re-armed: the cancelled notificationId is cleared but the retained
    // pending request survives, so activation reschedules on return.
    const raw = await AsyncStorage.getItem(
      'baci:savings-reminder-goal:user-a:00000000-0000-4000-8000-000000000010:goal-1'
    );
    expect(raw).toContain('goal-1');
    const rearmed = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    expect(rearmed.notificationId).toBeUndefined();
    expect(rearmed.pending).toEqual(
      expect.objectContaining({ goalId: 'goal-1' })
    );
    mockScheduleNotificationAsync.mockResolvedValueOnce('resumed-live');
    await expect(activateDueSavingsReminderNotification()).resolves.toBe(
      'resumed-live'
    );
  });

  it('retains the notification ID when scoped cancellation fails so a later cleanup can retry', async () => {
    mockScheduleNotificationAsync.mockResolvedValueOnce('prior-live');
    await scheduleSavingsReminderNotification({
      contributionAmount: 500,
      frequency: 'weekly',
      goalId: 'goal-1',
      goalTitle: 'Phone',
    });
    const scope = buildReminderScope(
      'user-a',
      '00000000-0000-4000-8000-000000000010'
    );
    expect(scope).not.toBeNull();
    if (!scope) throw new Error('expected a reminder scope');

    mockCancelScheduledNotificationAsync.mockRejectedValueOnce(
      new Error('bridge down')
    );
    await expect(cancelScopeSavingsReminders(scope)).resolves.toBe(false);

    // The live recurring notification keeps its ID: it is still
    // cancellable and sign-back-in must not re-arm a duplicate.
    const key =
      'baci:savings-reminder-goal:user-a:00000000-0000-4000-8000-000000000010:goal-1';
    const retained = JSON.parse(
      (await AsyncStorage.getItem(key)) ?? '{}'
    ) as Record<string, unknown>;
    expect(retained.notificationId).toBe('prior-live');
    await expect(activateDueSavingsReminderNotification()).resolves.toBeNull();
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);

    // A later cleanup retries the same live ID and re-arms on success.
    await expect(cancelScopeSavingsReminders(scope)).resolves.toBe(true);
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith(
      'prior-live'
    );
    const rearmed = JSON.parse(
      (await AsyncStorage.getItem(key)) ?? '{}'
    ) as Record<string, unknown>;
    expect(rearmed.notificationId).toBeUndefined();
    expect(rearmed.pending).toEqual(
      expect.objectContaining({ goalId: 'goal-1' })
    );
  });

  it('pins a queued schedule to the submitting account across a switch', async () => {
    const { savingsReminderStorage } =
      require('./savings-reminder-storage') as typeof import('./savings-reminder-storage');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocked = savingsReminderStorage.runExclusive(() => gate);
    mockAuthState.user = { id: 'user-a' };
    const scheduled = scheduleSavingsReminderNotification({
      contributionAmount: 500,
      frequency: 'weekly',
      goalId: 'goal-a',
      goalTitle: 'A phone',
    });
    // The account switches while the schedule waits behind the earlier op.
    mockAuthState.user = { id: 'user-b' };
    release();
    await blocked;
    await expect(scheduled).resolves.toBe('notification-id');

    const merchantId = '00000000-0000-4000-8000-000000000010';
    expect(
      await AsyncStorage.getItem(
        `baci:savings-reminder-goal:user-a:${merchantId}:goal-a`
      )
    ).not.toBeNull();
    expect(
      await AsyncStorage.getItem(
        `baci:savings-reminder-goal:user-b:${merchantId}:goal-a`
      )
    ).toBeNull();
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          body: expect.stringContaining('A phone'),
        }),
      })
    );
  });
});
