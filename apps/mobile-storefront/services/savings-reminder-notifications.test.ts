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

const {
  buildReminderScope,
  cancelSavingsReminderNotification,
  cancelScopeSavingsReminders,
  activateDueSavingsReminderNotification,
  scheduleSavingsReminderNotification,
} =
  require('./savings-reminder-notifications') as typeof import('./savings-reminder-notifications');
const { savingsNotificationCapability } =
  require('./savings-notification-capability') as typeof import('./savings-notification-capability');

describe('savings reminder notification capability', () => {
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

  it.each([
    'cancel-all',
    'server-push',
  ])('clears scheduled and pending goals for %s', async (reason) => {
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
    if (reason === 'server-push') {
      await savingsNotificationCapability.markAvailable({
        apiOrigin: 'https://api.baci.test',
        merchantId: '00000000-0000-4000-8000-000000000010',
        userId: 'user-a',
      });
      await activateDueSavingsReminderNotification();
    } else await cancelSavingsReminderNotification();
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(
      (await AsyncStorage.getAllKeys()).filter((key) =>
        key.startsWith('baci:savings-reminder-')
      )
    ).toEqual([]);
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
});
