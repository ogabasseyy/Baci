import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

type Inbox = Awaited<
  ReturnType<
    typeof import('@/services/savings-notification-inbox')['fetchSavingsNotificationInbox']
  >
>;
const mockFetchInbox = jest.fn<() => Promise<Inbox>>();
const mockMarkRead = jest.fn<() => Promise<{ success: true }>>();
const mockUpdatePreferences = jest.fn<() => Promise<{ success: true }>>();
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
  markSavingsNotificationRead: mockMarkRead,
  updateSavingsNotificationPreferences: mockUpdatePreferences,
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

describe('useSavingsNotificationInbox', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchInbox.mockResolvedValue(inbox);
    mockMarkRead.mockResolvedValue({ success: true });
    mockUpdatePreferences.mockResolvedValue({ success: true });
    mockMarkAvailable.mockResolvedValue();
    mockClearAvailable.mockResolvedValue();
    mockSuppressSavingsReminderNotification.mockResolvedValue(false);
    mockGetRegisteredPushToken.mockResolvedValue('ExponentPushToken[ok]');
  });

  it('loads the server inbox only after an authenticated merchant scope is available', async () => {
    const { result, rerender } = renderHook(
      ({ activeMerchantId }: { activeMerchantId: string | null }) =>
        useSavingsNotificationInbox({
          enabled: Boolean(activeMerchantId),
          merchantId: activeMerchantId,
          userId: 'user-a',
        }),
      { initialProps: { activeMerchantId: null as string | null } }
    );

    expect(mockFetchInbox).not.toHaveBeenCalled();
    expect(result.current.notifications).toEqual([]);

    rerender({ activeMerchantId: merchantId });

    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    expect(mockFetchInbox).toHaveBeenCalledWith({ merchantId });
    expect(mockMarkAvailable).toHaveBeenCalledWith({
      apiOrigin: 'https://api.baci.test',
      merchantId,
      userId: 'user-a',
    });
  });

  it('keeps a notification unread when read persistence fails', async () => {
    const { result } = renderHook(() =>
      useSavingsNotificationInbox({
        enabled: true,
        merchantId,
        userId: 'user-a',
      })
    );
    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    mockMarkRead.mockRejectedValueOnce(new Error('Unavailable'));

    await act(async () => {
      await expect(result.current.markRead(notificationId)).rejects.toThrow(
        'Unavailable'
      );
    });

    expect(result.current.notifications[0]?.readAt).toBeNull();
    expect(result.current.actionError).toBe('Unavailable');
  });

  it('updates the inbox only after the server accepts a weekly digest opt-in', async () => {
    const { result } = renderHook(() =>
      useSavingsNotificationInbox({
        enabled: true,
        merchantId,
        userId: 'user-a',
      })
    );
    await waitFor(() => expect(result.current.preferences).not.toBeNull());

    await act(async () => {
      await result.current.updatePreferences({ weeklySummaryEnabled: true });
    });

    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      merchantId,
      preferences: { weeklySummaryEnabled: true },
    });
    expect(result.current.preferences?.weeklySummaryEnabled).toBe(true);
  });

  it('retries a failed inbox load without inventing notifications', async () => {
    mockFetchInbox
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(inbox);
    const { result } = renderHook(() =>
      useSavingsNotificationInbox({
        enabled: true,
        merchantId,
        userId: 'user-a',
      })
    );

    await waitFor(() => expect(result.current.error).toBe('Offline'));
    expect(result.current.notifications).toEqual([]);

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    expect(mockFetchInbox).toHaveBeenCalledTimes(2);
    expect(mockMarkAvailable).toHaveBeenCalledTimes(1);
  });

  it('hides the previous account inbox immediately when the account changes', async () => {
    const accountBInbox = {
      ...inbox,
      notifications: [
        {
          ...inbox.notifications[0],
          id: '00000000-0000-4000-8000-000000000003',
        },
      ],
    };
    mockFetchInbox
      .mockResolvedValueOnce(inbox)
      .mockResolvedValueOnce(accountBInbox);
    const { result, rerender } = renderHook(
      ({ activeUserId }: { activeUserId: string }) =>
        useSavingsNotificationInbox({
          enabled: true,
          merchantId,
          userId: activeUserId,
        }),
      { initialProps: { activeUserId: 'user-a' } }
    );
    await waitFor(() => expect(result.current.notifications).toHaveLength(1));

    rerender({ activeUserId: 'user-b' });

    expect(result.current.notifications).toEqual([]);
    expect(result.current.preferences).toBeNull();
    await waitFor(() =>
      expect(result.current.notifications[0]?.id).toBe(
        '00000000-0000-4000-8000-000000000003'
      )
    );
  });
});
