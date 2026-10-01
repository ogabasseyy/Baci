import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

type NotificationResponse = import('expo-notifications').NotificationResponse;
const mockRouterPush = jest.fn();
const mockNotificationListenerRemove = jest.fn<() => void>();
const mockResponseListenerRemove = jest.fn<() => void>();
const mockEnsureAndroidNotificationChannels = jest.fn<() => Promise<void>>();
const mockGetStoredPushToken = jest.fn<() => Promise<string | null>>();
const mockTrackNotificationInteraction =
  jest.fn<
    (event: string, notificationType: string, notificationId: string) => void
  >();
const mockGetLastNotificationResponse =
  jest.fn<() => Promise<NotificationResponse | null>>();
const mockClearLastNotificationResponse = jest.fn<() => void>();
const mockHandleNotificationResponse =
  jest.fn<
    typeof import('@/services/push-notifications')['handleNotificationResponse']
  >();
let mockNotificationResponseCallback:
  | ((response: NotificationResponse) => void)
  | null = null;
jest.mock('expo-router', () => ({ router: { push: mockRouterPush } }));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn() }),
}));
jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: jest.fn(() => ({
    remove: mockNotificationListenerRemove,
  })),
  addNotificationResponseReceivedListener: jest.fn(
    (callback: (response: NotificationResponse) => void) => {
      mockNotificationResponseCallback = callback;
      return { remove: mockResponseListenerRemove };
    }
  ),
  getLastNotificationResponseAsync: mockGetLastNotificationResponse,
  clearLastNotificationResponse: mockClearLastNotificationResponse,
}));
jest.mock('@/lib/push-token-storage', () => ({
  getStoredPushToken: mockGetStoredPushToken,
  storeLocalPushToken: jest.fn(),
  clearStoredPushToken: jest.fn(),
  isPushOptedOut: jest.fn(),
  setPushOptOut: jest.fn(),
}));
jest.mock('@/services/push-notification-channels', () => ({
  ensureAndroidNotificationChannels: mockEnsureAndroidNotificationChannels,
}));
jest.mock('@/services/analytics', () => ({
  trackError: jest.fn(),
  trackNotificationInteraction: mockTrackNotificationInteraction,
}));
jest.mock('@/services/push-notifications', () => ({
  clearBadge: jest.fn(),
  handleNotificationResponse: mockHandleNotificationResponse,
  registerForPushNotifications: jest.fn(),
  removePushTokenFromServer: jest.fn(),
  savePushTokenToServer: jest.fn(),
}));
jest.mock('@/stores/auth-store', () => ({ useAuthStore: jest.fn() }));
const mockedUseAuthStore = (
  jest.requireMock('@/stores/auth-store') as {
    useAuthStore: jest.MockedFunction<
      (
        selector: (state: {
          merchantId: string;
          user: { id: string };
        }) => unknown
      ) => unknown
    >;
  }
).useAuthStore;
const { usePushNotifications } =
  require('./use-push-notifications') as typeof import('./use-push-notifications');
const createResponse = (
  identifier: string,
  data: Record<string, unknown>,
  date: number
): NotificationResponse =>
  ({
    notification: { date, request: { identifier, content: { data } } },
  }) as NotificationResponse;

const waitForResponseListener = () =>
  waitFor(() => expect(mockNotificationResponseCallback).not.toBeNull());
describe('usePushNotifications response handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNotificationResponseCallback = null;
    mockTrackNotificationInteraction.mockReset();
    mockGetLastNotificationResponse.mockResolvedValue(null);
    mockGetStoredPushToken.mockResolvedValue(null);
    mockEnsureAndroidNotificationChannels.mockResolvedValue(undefined);
    mockedUseAuthStore.mockImplementation((selector) =>
      selector({ merchantId: 'merchant-1', user: { id: 'user-1' } })
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('routes token-ready notification taps to utility history', async () => {
    mockHandleNotificationResponse.mockImplementation(
      (
        _response: unknown,
        navigate: (screen: string, params?: Record<string, string>) => void
      ) => navigate('utility-history', { type: 'power' })
    );
    renderHook(() => usePushNotifications());
    await waitForResponseListener();

    act(() => {
      mockNotificationResponseCallback?.(
        createResponse(
          'response-utility',
          { notification_id: 'campaign-1', notification_type: 'promotion' },
          1000
        )
      );
    });

    expect(mockRouterPush).toHaveBeenCalledWith(
      '/utilities/history?type=power'
    );
    expect(mockTrackNotificationInteraction).toHaveBeenCalledWith(
      'opened',
      'promotion',
      'campaign-1'
    );
  });

  it('counts a notification tap once when Expo emits duplicate responses', async () => {
    renderHook(() => usePushNotifications());
    await waitForResponseListener();
    const response = createResponse(
      'response-duplicate',
      { notification_type: 'promotion' },
      2000
    );

    act(() => {
      mockNotificationResponseCallback?.(response);
      mockNotificationResponseCallback?.(response);
    });

    expect(mockTrackNotificationInteraction).toHaveBeenCalledTimes(1);
  });

  it('counts distinct deliveries separately when they share a payload notification id', async () => {
    renderHook(() => usePushNotifications());
    await waitForResponseListener();
    const firstDelivery = createResponse(
      'response-delivery-1',
      { notification_id: 'campaign-shared', notification_type: 'promotion' },
      3000
    );
    const secondDelivery = createResponse(
      'response-delivery-2',
      { notification_id: 'campaign-shared', notification_type: 'promotion' },
      4000
    );

    act(() => {
      mockNotificationResponseCallback?.(firstDelivery);
      mockNotificationResponseCallback?.(secondDelivery);
    });

    expect(mockTrackNotificationInteraction).toHaveBeenCalledTimes(2);
    expect(mockHandleNotificationResponse).toHaveBeenCalledTimes(2);
  });

  it('still handles a notification response when analytics tracking throws', async () => {
    mockTrackNotificationInteraction.mockImplementation(() => {
      throw new Error('analytics unavailable');
    });
    renderHook(() => usePushNotifications());
    await waitForResponseListener();
    const response = createResponse(
      'response-analytics-failure',
      { notification_type: 'promotion' },
      5000
    );

    expect(() =>
      act(() => mockNotificationResponseCallback?.(response))
    ).not.toThrow();
    expect(mockHandleNotificationResponse).toHaveBeenCalledTimes(1);
  });

  it('tracks a notification opened from a cold start', async () => {
    mockGetLastNotificationResponse.mockResolvedValue(
      createResponse(
        'response-cold-start',
        { notification_type: 'promotion' },
        6000
      )
    );
    renderHook(() => usePushNotifications());

    await waitFor(() => {
      expect(mockTrackNotificationInteraction).toHaveBeenCalledWith(
        'opened',
        'promotion',
        'response-cold-start'
      );
    });
    expect(mockClearLastNotificationResponse).toHaveBeenCalledTimes(1);
  });

  it('retries cold-start navigation after the root navigator becomes ready', async () => {
    jest.useFakeTimers();
    mockGetLastNotificationResponse.mockResolvedValue(
      createResponse(
        'response-cold-start-navigation-retry',
        { notification_type: 'promotion' },
        6500
      )
    );
    mockHandleNotificationResponse.mockImplementationOnce(() => {
      throw new Error('navigator is not ready');
    });

    renderHook(() => usePushNotifications());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockHandleNotificationResponse).toHaveBeenCalledTimes(1);
    expect(mockClearLastNotificationResponse).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(250);
    });

    expect(mockHandleNotificationResponse).toHaveBeenCalledTimes(2);
    expect(mockTrackNotificationInteraction).toHaveBeenCalledTimes(1);
    expect(mockClearLastNotificationResponse).toHaveBeenCalledTimes(1);
  });

  it('does not re-track a cold-start response after the hook remounts', async () => {
    const response = createResponse(
      'response-remount',
      { notification_type: 'promotion' },
      7000
    );
    mockGetLastNotificationResponse.mockResolvedValue(response);
    const firstMount = renderHook(() => usePushNotifications());

    await waitFor(() =>
      expect(mockTrackNotificationInteraction).toHaveBeenCalledTimes(1)
    );
    firstMount.unmount();
    renderHook(() => usePushNotifications());

    await waitFor(() =>
      expect(mockGetLastNotificationResponse).toHaveBeenCalledTimes(2)
    );
    expect(mockTrackNotificationInteraction).toHaveBeenCalledTimes(1);
    expect(mockHandleNotificationResponse).toHaveBeenCalledTimes(1);
  });

  it('routes savings reminder notification taps to the wallet savings action', async () => {
    mockHandleNotificationResponse.mockImplementation(
      (
        _response: unknown,
        navigate: (screen: string, params?: Record<string, string>) => void
      ) => navigate('wallet', { action: 'savings' })
    );
    renderHook(() => usePushNotifications());
    await waitForResponseListener();

    act(() => {
      mockNotificationResponseCallback?.(
        createResponse(
          'response-savings',
          { notification_type: 'savings_reminder' },
          8000
        )
      );
    });

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/wallet',
      params: { action: 'savings' },
    });
  });
});
