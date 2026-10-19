import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { Notification } from 'expo-notifications';
import { createElement, type ReactNode } from 'react';
import { SavingsNotificationList } from '@/components/notifications/SavingsNotificationList';
import type { SavingsNotification } from '@/schemas/savings-notifications';

const merchantId = '10000000-0000-4000-8000-000000000001';
const mockAuth = {
  merchantId,
  user: { id: 'user-1' },
  customer: { id: 'customer-1' },
};
let mockReceive: ((notification: Notification) => void) | undefined;
const mockInvalidate = jest.fn<Promise<void>, [unknown]>();
const mockFetch = jest.fn();
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(
    (selector: (state: typeof mockAuth) => unknown) => selector(mockAuth),
    { getState: () => mockAuth }
  ),
}));
jest.mock('@/hooks/use-savings-push-registration', () => ({
  useSavingsPushRegistration: jest.fn(() => ({})),
}));
jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: '10000000-0000-4000-8000-000000000001' },
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn() }),
}));
jest.mock('@/services/savings-wallet-cache', () => ({
  invalidateSavingsWalletCache: (scope: unknown) => mockInvalidate(scope),
}));
jest.mock('@/lib/customer-savings-api', () => ({
  getCustomerSavingsApiClient: () => ({ fetchJson: mockFetch }),
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('@shopify/flash-list', () => ({
  FlashList: ({
    data,
    ListEmptyComponent,
    renderItem,
  }: {
    data: SavingsNotification[];
    ListEmptyComponent: () => ReactNode;
    renderItem: (input: { item: SavingsNotification }) => ReactNode;
  }) => {
    const { createElement, Fragment } =
      require('react') as typeof import('react');
    return createElement(
      Fragment,
      null,
      data.length
        ? data.map((item) =>
            createElement(Fragment, { key: item.id }, renderItem({ item }))
          )
        : ListEmptyComponent()
    );
  },
}));
jest.mock('@/services/savings-notification-capability', () => ({
  savingsNotificationCapability: {
    markAvailable: jest.fn(async () => {}),
    clearAvailable: jest.fn(async () => {}),
  },
}));
jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: jest.fn(async () => {}),
}));
jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: jest.fn(
    (listener: (notification: Notification) => void) => {
      mockReceive = listener;
      return { remove: jest.fn() };
    }
  ),
  addNotificationResponseReceivedListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
}));
jest.mock('@/hooks/process-push-notification-response', () => ({
  processPushNotificationResponse: jest.fn(),
}));

const { usePushNotifications } =
  require('./use-push-notifications') as typeof import('./use-push-notifications');
const { useSavingsNotificationInbox } =
  require('./use-savings-notification-inbox') as typeof import('./use-savings-notification-inbox');
const payload = {
  type: 'savings',
  merchantId,
  goalId: '20000000-0000-4000-8000-000000000002',
  notificationId: '30000000-0000-4000-8000-000000000003',
};
const notification = (data: Record<string, unknown>) =>
  ({
    request: { content: { data } },
  }) as Notification;
const preferences = {
  encouragementEnabled: true,
  interestAlertsEnabled: true,
  weeklySummaryEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
  timeZone: 'Africa/Lagos',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockReceive = undefined;
  mockInvalidate.mockResolvedValue(undefined);
  mockFetch.mockResolvedValue({
    deliveryEnabled: true,
    notifications: [],
    preferences,
  });
});

function useNotificationJourney() {
  usePushNotifications();
  return useSavingsNotificationInbox({
    enabled: true,
    merchantId,
    userId: 'user-1',
  });
}

it('refreshes wallet and visible earnings inbox when a scoped savings push arrives in the foreground', async () => {
  function NotificationJourney() {
    const inbox = useNotificationJourney();
    return createElement(SavingsNotificationList, {
      header: null,
      isLoading: inbox.isLoading,
      notifications: inbox.notifications,
      requestError: inbox.error,
      onRetry: inbox.retry,
      onOpen: jest.fn(),
    });
  }
  render(createElement(NotificationJourney));
  await screen.findByText('No savings updates yet');
  const event = {
    id: payload.notificationId,
    goalId: payload.goalId,
    title: 'Your savings earned interest',
    body: '₦150.00 in confirmed savings interest has been credited to you.',
    type: 'savings_interest_credited',
    createdAt: '2026-09-26T19:00:00Z',
    readAt: null,
  };
  mockFetch.mockResolvedValue({
    deliveryEnabled: true,
    notifications: [event],
    preferences,
  });

  await act(async () =>
    mockReceive?.(notification({ ...payload, body: 'Untrusted push text' }))
  );

  expect(
    await screen.findByRole('button', { name: event.title })
  ).toBeOnTheScreen();
  expect(screen.getByText(event.body)).toBeOnTheScreen();
  expect(screen.queryByText('Untrusted push text')).toBeNull();
  expect(mockFetch).toHaveBeenLastCalledWith({
    path: '/api/storefront/customer/savings/notifications',
    query: { merchantId },
  });
  expect(mockInvalidate).toHaveBeenCalledWith({
    merchantId,
    ownerId: 'customer-1',
  });
});

it.each([
  { ...payload, merchantId: '10000000-0000-4000-8000-000000000099' },
  { ...payload, notificationId: 'malformed' },
  { type: 'order' },
])('ignores other-merchant and malformed foreground payloads', async (data) => {
  const { result } = renderHook(useNotificationJourney);
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  await act(async () => mockReceive?.(notification(data)));
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(mockInvalidate).not.toHaveBeenCalled();
});
