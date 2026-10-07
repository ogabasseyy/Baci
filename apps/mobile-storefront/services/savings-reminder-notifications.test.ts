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
  buildReminderScope,
  cancelSavingsReminderNotification,
  cancelScopeSavingsReminders,
  activateDueSavingsReminderNotification,
  scheduleSavingsReminderNotification,
  suppressSavingsReminderNotification,
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
