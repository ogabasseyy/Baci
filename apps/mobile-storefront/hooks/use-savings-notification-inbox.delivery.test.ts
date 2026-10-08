import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

type Inbox = Awaited<
  ReturnType<
    typeof import('@/services/savings-notification-inbox')['fetchSavingsNotificationInbox']
  >
>;
const mockFetchInbox = jest.fn<() => Promise<Inbox>>();
const mockMarkAvailable =
  jest.fn<
    (scope: {
      apiOrigin: string;
      merchantId: string;
      userId: string;
    }) => Promise<void>
  >();
const mockClearAvailable =
  jest.fn<
    (scope: {
      apiOrigin: string;
      merchantId: string;
      userId: string;
    }) => Promise<void>
  >();
const mockSuppressSavingsReminderNotification =
  jest.fn<() => Promise<boolean>>();
const mockGetRegisteredPushToken =
  jest.fn<(userId: string, merchantId: string) => Promise<string | null>>();

jest.mock('@/services/savings-notification-inbox', () => ({
  fetchSavingsNotificationInbox: mockFetchInbox,
  markSavingsNotificationRead: jest.fn(),
  updateSavingsNotificationPreferences: jest.fn(),
}));
jest.mock('@/services/savings-notification-capability', () => ({
  savingsNotificationCapability: {
    clearAvailable: mockClearAvailable,
    markAvailable: mockMarkAvailable,
  },
}));
jest.mock('@/env', () => ({ EXPO_PUBLIC_API_URL: 'https://api.baci.test' }));
jest.mock('@/services/savings-reminder-notifications', () => ({
  suppressSavingsReminderNotification: mockSuppressSavingsReminderNotification,
}));
jest.mock('@/lib/push-token-storage', () => ({
  getRegisteredPushToken: mockGetRegisteredPushToken,
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

const { useSavingsNotificationInbox } =
  require('./use-savings-notification-inbox') as typeof import('./use-savings-notification-inbox');

const merchantId = '00000000-0000-4000-8000-000000000010';
const notificationId = '00000000-0000-4000-8000-000000000001';
const goalId = '00000000-0000-4000-8000-000000000002';
const preferences = {
  encouragementEnabled: true,
  interestAlertsEnabled: true,
  quietHoursEnd: '08:00',
  quietHoursStart: '22:00',
  timeZone: 'Africa/Lagos',
  weeklySummaryEnabled: false,
};

const inbox = {
  deliveryEnabled: true,
  notifications: [
    {
      body: 'Your savings interest has been credited.',
      createdAt: '2026-09-25T10:00:00.000Z',
      goalId,
      id: notificationId,
      readAt: null,
      title: 'Interest credited',
      type: 'savings_interest_credited',
    },
  ],
  preferences,
};

describe('useSavingsNotificationInbox server-delivery suppression', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthState.merchantId = '00000000-0000-4000-8000-000000000010';
    mockAuthState.user = { id: 'user-a' };
    mockFetchInbox.mockResolvedValue(inbox);
    mockMarkAvailable.mockResolvedValue();
    mockClearAvailable.mockResolvedValue();
    mockSuppressSavingsReminderNotification.mockResolvedValue(false);
    mockGetRegisteredPushToken.mockResolvedValue('ExponentPushToken[ok]');
  });

  it('preserves local reminders when a successful inbox says delivery is disabled', async () => {
    mockFetchInbox.mockResolvedValueOnce({ ...inbox, deliveryEnabled: false });
    const { result } = renderHook(() =>
      useSavingsNotificationInbox({
        enabled: true,
        merchantId,
        userId: 'user-a',
      })
    );

    await waitFor(() => expect(result.current.notifications).toHaveLength(1));

    expect(mockMarkAvailable).not.toHaveBeenCalled();
    expect(mockSuppressSavingsReminderNotification).not.toHaveBeenCalled();
    expect(mockClearAvailable).toHaveBeenCalledWith({
      apiOrigin: 'https://api.baci.test',
      merchantId,
      userId: 'user-a',
    });
  });

  it('keeps local reminders when delivery is enabled but this device never registered', async () => {
    mockGetRegisteredPushToken.mockResolvedValue(null);
    const { result } = renderHook(() =>
      useSavingsNotificationInbox({
        enabled: true,
        merchantId,
        userId: 'user-a',
      })
    );

    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    await waitFor(() =>
      expect(mockGetRegisteredPushToken).toHaveBeenCalledWith(
        'user-a',
        merchantId
      )
    );

    expect(mockMarkAvailable).not.toHaveBeenCalled();
    expect(mockSuppressSavingsReminderNotification).not.toHaveBeenCalled();
    expect(mockClearAvailable).toHaveBeenCalledWith({
      apiOrigin: 'https://api.baci.test',
      merchantId,
      userId: 'user-a',
    });
  });

  it('skips clearing local reminders when the account changes while markAvailable is in flight', async () => {
    let resolveFirstMark!: () => void;
    const firstMark = new Promise<void>((resolve) => {
      resolveFirstMark = resolve;
    });
    mockMarkAvailable
      .mockImplementationOnce(() => firstMark)
      .mockImplementation(() => new Promise<void>(() => {}));
    const { rerender } = renderHook(
      ({ activeUserId }: { activeUserId: string }) =>
        useSavingsNotificationInbox({
          enabled: true,
          merchantId,
          userId: activeUserId,
        }),
      { initialProps: { activeUserId: 'user-a' } }
    );
    await waitFor(() =>
      expect(mockMarkAvailable).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-a' })
      )
    );

    rerender({ activeUserId: 'user-b' });
    await waitFor(() =>
      expect(mockMarkAvailable).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-b' })
      )
    );

    await act(async () => {
      resolveFirstMark();
      await firstMark;
    });

    expect(mockSuppressSavingsReminderNotification).not.toHaveBeenCalled();
  });

  it('suppresses local reminders with the captured scope once server delivery is confirmed', async () => {
    const { result } = renderHook(() =>
      useSavingsNotificationInbox({
        enabled: true,
        merchantId,
        userId: 'user-a',
      })
    );

    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    await waitFor(() =>
      expect(mockSuppressSavingsReminderNotification).toHaveBeenCalledWith({
        merchantId,
        userId: 'user-a',
      })
    );

    expect(mockMarkAvailable).toHaveBeenCalledWith({
      apiOrigin: 'https://api.baci.test',
      merchantId,
      userId: 'user-a',
    });
  });

  it('skips suppression when inbox props disagree with the auth store', async () => {
    // Stale props during an account switch: the hook still renders user-a
    // while the store already moved to user-b.
    mockAuthState.user = { id: 'user-b' };
    const { result } = renderHook(() =>
      useSavingsNotificationInbox({
        enabled: true,
        merchantId,
        userId: 'user-a',
      })
    );

    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    await waitFor(() =>
      expect(mockMarkAvailable).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-a' })
      )
    );
    // Flush the markAvailable continuation, then assert it skipped the
    // mistargeted suppression (clearAvailable also untouched: the registered
    // device path was taken, not the fallback branch).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockSuppressSavingsReminderNotification).not.toHaveBeenCalled();
    expect(mockClearAvailable).not.toHaveBeenCalled();
  });
});
