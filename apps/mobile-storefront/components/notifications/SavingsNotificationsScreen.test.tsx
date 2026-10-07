import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { ReactNode } from 'react';
import type { useSavingsNotificationInbox } from '@/hooks/use-savings-notification-inbox';
import { getSavingsNotificationAccessibilityLabel } from './SavingsNotificationList';

type Inbox = ReturnType<typeof useSavingsNotificationInbox>;

const mockMarkRead = jest.fn<(notificationId: string) => Promise<void>>();
const mockRetry = jest.fn<() => void>();
const mockUpdatePreferences = jest.fn<Inbox['updatePreferences']>();
const mockRouterPush = jest.fn<(input: unknown) => void>();
const mockUseSavingsNotificationInbox = jest.fn<() => Inbox>();

jest.mock('expo-router', () => ({
  router: { push: (input: unknown) => mockRouterPush(input) },
}));

jest.mock('@shopify/flash-list', () => ({
  FlashList: ({
    data,
    ListEmptyComponent,
    ListHeaderComponent,
    renderItem,
  }: {
    data: unknown[];
    ListEmptyComponent?: ReactNode | (() => ReactNode);
    ListHeaderComponent?: ReactNode | (() => ReactNode);
    renderItem: (input: { item: never }) => ReactNode;
  }) => {
    const { View } = require('react-native') as typeof import('react-native');
    return (
      <View>
        {typeof ListHeaderComponent === 'function'
          ? ListHeaderComponent()
          : ListHeaderComponent}
        {data.length > 0
          ? data.map((item, index) => (
              <View key={String(index)}>
                {renderItem({ item: item as never })}
              </View>
            ))
          : typeof ListEmptyComponent === 'function'
            ? ListEmptyComponent()
            : ListEmptyComponent}
      </View>
    );
  },
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/hooks/use-savings-notification-inbox', () => ({
  useSavingsNotificationInbox: () => mockUseSavingsNotificationInbox(),
}));

const { SavingsNotificationsScreen } =
  require('./SavingsNotificationsScreen') as typeof import('./SavingsNotificationsScreen');

const preferences = {
  encouragementEnabled: true,
  interestAlertsEnabled: true,
  quietHoursEnd: '08:00',
  quietHoursStart: '22:00',
  timeZone: 'Africa/Lagos',
  weeklySummaryEnabled: false,
};
const notification = {
  body: 'Your savings interest has been credited.',
  createdAt: '2026-09-25T10:00:00.000Z',
  goalId: '00000000-0000-4000-8000-000000000002',
  id: '00000000-0000-4000-8000-000000000001',
  readAt: null,
  title: 'Interest credited',
  type: 'savings_interest_credited',
};

describe('SavingsNotificationsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMarkRead.mockResolvedValue();
    mockUpdatePreferences.mockResolvedValue();
    mockUseSavingsNotificationInbox.mockReturnValue({
      actionError: null,
      error: null,
      isLoading: false,
      isSaving: false,
      markRead: mockMarkRead,
      notifications: [],
      preferences,
      retry: mockRetry,
      updatePreferences: mockUpdatePreferences,
    });
  });

  it('shows a retry state instead of fabricated notifications when the inbox request fails', () => {
    mockUseSavingsNotificationInbox.mockReturnValue({
      ...mockUseSavingsNotificationInbox(),
      error: 'Offline',
      preferences: null,
    });

    render(
      <SavingsNotificationsScreen
        merchantId="00000000-0000-4000-8000-000000000010"
        userId="user-a"
      />
    );
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('Offline')).toBeOnTheScreen();
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it('opens the authenticated wallet savings route and persists the read state for a tapped notification', async () => {
    mockUseSavingsNotificationInbox.mockReturnValue({
      ...mockUseSavingsNotificationInbox(),
      notifications: [notification],
    });

    render(
      <SavingsNotificationsScreen
        merchantId="00000000-0000-4000-8000-000000000010"
        userId="user-a"
      />
    );
    fireEvent.press(
      screen.getByRole('button', {
        name: getSavingsNotificationAccessibilityLabel(
          notification.title,
          notification.createdAt
        ),
      })
    );

    expect(mockMarkRead).toHaveBeenCalledWith(notification.id);
    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith({
        pathname: '/wallet',
        params: {
          action: 'savings',
          savingsGoalId: '00000000-0000-4000-8000-000000000002',
        },
      });
    });
  });

  it('stays on the inbox with the action error visible when marking read fails', async () => {
    mockMarkRead.mockRejectedValueOnce(new Error('Offline'));
    mockUseSavingsNotificationInbox.mockReturnValue({
      ...mockUseSavingsNotificationInbox(),
      actionError: 'Offline',
      notifications: [notification],
    });

    render(
      <SavingsNotificationsScreen
        merchantId="00000000-0000-4000-8000-000000000010"
        userId="user-a"
      />
    );
    fireEvent.press(
      screen.getByRole('button', {
        name: getSavingsNotificationAccessibilityLabel(
          notification.title,
          notification.createdAt
        ),
      })
    );

    await waitFor(() => {
      expect(mockMarkRead).toHaveBeenCalledWith(notification.id);
    });
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(screen.getByText('Offline')).toBeOnTheScreen();
  });

  it('keeps the weekly digest opt-in disabled until the customer enables it', () => {
    render(
      <SavingsNotificationsScreen
        merchantId="00000000-0000-4000-8000-000000000010"
        userId="user-a"
      />
    );

    const weeklyDigest = screen.getByRole('switch', {
      name: 'Weekly savings summary',
    });
    expect(weeklyDigest.props.value).toBe(false);
    fireEvent(weeklyDigest, 'valueChange', true);

    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      weeklySummaryEnabled: true,
    });
  });

  it('persists edited quiet hours and the displayed timezone without device defaults', () => {
    render(
      <SavingsNotificationsScreen
        merchantId="00000000-0000-4000-8000-000000000010"
        userId="user-a"
      />
    );

    const quietHoursStart = screen.getByLabelText('Quiet hours from');
    fireEvent.changeText(quietHoursStart, '23:30');
    fireEvent(quietHoursStart, 'endEditing');
    const timeZone = screen.getByLabelText('Savings notification time zone');
    fireEvent.changeText(timeZone, 'Europe/London');
    fireEvent(timeZone, 'endEditing');

    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      quietHoursStart: '23:30',
    });
    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      timeZone: 'Europe/London',
    });
  });
});
