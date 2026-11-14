import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { NotificationResponse } from 'expo-notifications';

const mockGetLastResponse = jest.fn<Promise<NotificationResponse | null>, []>();
const mockHandleResponse = jest.fn();
const mockAuth = { customer: null, merchantId: 'merchant-1', user: null };

jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
  getLastNotificationResponseAsync: mockGetLastResponse,
  clearLastNotificationResponse: jest.fn(),
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn() }),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(
    jest.fn((selector) => selector(mockAuth)),
    {
      getState: () => mockAuth,
    }
  ),
}));
jest.mock('@/services/push-notifications', () => ({
  handleNotificationResponse: mockHandleResponse,
  clearBadge: jest.fn(),
  registerForPushNotifications: jest.fn(),
  removePushTokenFromServer: jest.fn(),
  savePushTokenToServer: jest.fn(),
}));
jest.mock('./use-savings-push-registration', () => ({
  useSavingsPushRegistration: () => ({
    error: null,
    isLoading: false,
    isRegistered: false,
    register: jest.fn(),
    registeredUserId: null,
  }),
}));
jest.mock('./use-savings-reminder-delivery', () => ({
  useSavingsReminderDelivery: jest.fn(),
}));

const { usePushNotifications } =
  require('./use-push-notifications') as typeof import('./use-push-notifications');

describe('usePushNotifications cancellation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ignores a cold-start response that resolves after the hook unmounts', async () => {
    let resolveResponse: (value: NotificationResponse | null) => void =
      () => {};
    mockGetLastResponse.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        })
    );
    const { unmount } = renderHook(() => usePushNotifications());

    await waitFor(() => expect(mockGetLastResponse).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => {
      resolveResponse({
        actionIdentifier: 'default',
        notification: {
          date: 1,
          request: {
            identifier: 'stale-response',
            content: { data: { notification_type: 'promotion' } },
          },
        },
      } as unknown as NotificationResponse);
    });

    expect(mockHandleResponse).not.toHaveBeenCalled();
  });
});
