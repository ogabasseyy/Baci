import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

type PushNotificationsModule = typeof import('@/services/push-notifications');
type NotificationResponse = import('expo-notifications').NotificationResponse;

const mockRouterPush = jest.fn();
const mockNotificationListenerRemove = jest.fn<() => void>();
const mockResponseListenerRemove = jest.fn<() => void>();
const mockEnsureAndroidNotificationChannels = jest.fn<() => Promise<void>>();
const mockGetStoredPushToken = jest.fn<() => Promise<string | null>>();
const mockTrackNotificationInteraction = jest.fn();
const mockGetLastNotificationResponse =
  jest.fn<() => Promise<NotificationResponse | null>>();
const mockClearLastNotificationResponse = jest.fn<() => void>();
const mockHandleNotificationResponse =
  jest.fn<PushNotificationsModule['handleNotificationResponse']>();
let mockNotificationResponseCallback:
  | ((response: NotificationResponse) => void)
  | null = null;
const mockAuthSnapshot = {
  customer: { id: 'customer-1' },
  merchantId: 'merchant-1',
  user: { id: 'user-1' },
};

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
  getRegisteredPushToken: jest.fn(async () => null),
  setRegisteredPushToken: jest.fn(async () => {}),
  clearRegisteredPushToken: jest.fn(async () => {}),
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
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(jest.fn(), {
    getState: () => mockAuthSnapshot,
  }),
}));

const mockedUseAuthStore = (
  jest.requireMock('@/stores/auth-store') as {
    useAuthStore: jest.MockedFunction<
      (
        selector: (state: {
          customer: { id: string } | null;
          merchantId: string;
          user: { id: string };
        }) => unknown
      ) => unknown
    > & { getState: () => typeof mockAuthSnapshot };
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

describe('usePushNotifications navigation readiness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNotificationResponseCallback = null;
    mockGetLastNotificationResponse.mockResolvedValue(null);
    mockGetStoredPushToken.mockResolvedValue(null);
    mockEnsureAndroidNotificationChannels.mockResolvedValue(undefined);
    mockedUseAuthStore.mockImplementation((selector) =>
      selector(mockAuthSnapshot)
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('preserves distinct notification taps queued before navigation is ready', async () => {
    const view = renderHook(
      ({ navigationReady }: { navigationReady: boolean }) =>
        usePushNotifications({ navigationReady }),
      { initialProps: { navigationReady: false } }
    );
    await waitForResponseListener();
    const first = createResponse(
      'tap-during-splash-first',
      { notification_type: 'promotion' },
      1881
    );
    const second = createResponse(
      'tap-during-splash-second',
      { notification_type: 'promotion' },
      1882
    );

    act(() => {
      mockNotificationResponseCallback?.(first);
      mockNotificationResponseCallback?.(second);
    });
    view.rerender({ navigationReady: true });

    await waitFor(() =>
      expect(mockHandleNotificationResponse).toHaveBeenCalledTimes(2)
    );
    expect(mockHandleNotificationResponse).toHaveBeenNthCalledWith(
      1,
      first,
      expect.any(Function),
      undefined,
      'merchant-1',
      expect.any(Function)
    );
    expect(mockHandleNotificationResponse).toHaveBeenNthCalledWith(
      2,
      second,
      expect.any(Function),
      undefined,
      'merchant-1',
      expect.any(Function)
    );
  });

  it('only reads the cold-start response once when navigation readiness flaps', async () => {
    const coldResponse = createResponse(
      'cold-response-readiness-flap',
      { notification_type: 'promotion' },
      1883
    );
    mockGetLastNotificationResponse.mockResolvedValue(coldResponse);
    const view = renderHook(
      ({ navigationReady }: { navigationReady: boolean }) =>
        usePushNotifications({ navigationReady }),
      { initialProps: { navigationReady: false } }
    );
    await waitForResponseListener();

    view.rerender({ navigationReady: true });
    await waitFor(() =>
      expect(mockHandleNotificationResponse).toHaveBeenCalledTimes(1)
    );
    view.rerender({ navigationReady: false });
    view.rerender({ navigationReady: true });

    expect(mockGetLastNotificationResponse).toHaveBeenCalledTimes(1);
    expect(mockHandleNotificationResponse).toHaveBeenCalledTimes(1);
  });

  it('retains a cold-start response when navigation becomes unready during lookup', async () => {
    let resolveColdResponse:
      | ((response: NotificationResponse) => void)
      | undefined;
    mockGetLastNotificationResponse.mockReturnValue(
      new Promise((resolve) => {
        resolveColdResponse = resolve;
      })
    );
    const coldResponse = createResponse(
      'cold-response-readiness-during-lookup',
      { notification_type: 'promotion' },
      1884
    );
    const view = renderHook(
      ({ navigationReady }: { navigationReady: boolean }) =>
        usePushNotifications({ navigationReady }),
      { initialProps: { navigationReady: false } }
    );
    await waitForResponseListener();

    view.rerender({ navigationReady: true });
    await waitFor(() =>
      expect(mockGetLastNotificationResponse).toHaveBeenCalledTimes(1)
    );
    view.rerender({ navigationReady: false });
    await act(async () => {
      resolveColdResponse?.(coldResponse);
      await Promise.resolve();
    });
    expect(mockHandleNotificationResponse).not.toHaveBeenCalled();

    view.rerender({ navigationReady: true });
    await waitFor(() =>
      expect(mockHandleNotificationResponse).toHaveBeenCalledWith(
        coldResponse,
        expect.any(Function),
        undefined,
        'merchant-1',
        expect.any(Function)
      )
    );
    expect(mockGetLastNotificationResponse).toHaveBeenCalledTimes(1);
  });
});
