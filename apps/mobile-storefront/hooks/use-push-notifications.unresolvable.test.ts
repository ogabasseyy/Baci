import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

type AuthStoreSnapshot = {
  merchantId: string | null;
  user: { id: string } | null;
};

type AuthStoreSelector = (state: AuthStoreSnapshot) => unknown;
let mockAuthSnapshot: AuthStoreSnapshot = {
  merchantId: '',
  user: { id: 'user-1' },
};

const mockRegisterForPushNotifications =
  jest.fn<() => Promise<string | null>>();
const mockSavePushTokenToServer =
  jest.fn<
    (token: string, userId: string, merchantId: string) => Promise<boolean>
  >();
const mockGetStoredPushToken = jest.fn<() => Promise<string | null>>();
const mockStoreLocalPushToken = jest.fn<(token: string) => Promise<void>>();
const mockTrackError = jest.fn();

jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: '' },
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
  getLastNotificationResponseAsync: jest
    .fn<() => Promise<null>>()
    .mockResolvedValue(null),
}));

jest.mock('@/services/analytics', () => ({
  trackError: mockTrackError,
}));

jest.mock('@/services/push-notifications', () => ({
  clearBadge: jest.fn(),
  handleNotificationResponse: jest.fn(),
  registerForPushNotifications: mockRegisterForPushNotifications,
  removePushTokenFromServer: jest.fn(),
  savePushTokenToServer: mockSavePushTokenToServer,
}));

jest.mock('@/lib/push-token-storage', () => ({
  getStoredPushToken: mockGetStoredPushToken,
  storeLocalPushToken: mockStoreLocalPushToken,
  clearStoredPushToken: jest.fn(),
  isPushOptedOut: jest.fn<() => Promise<boolean>>().mockResolvedValue(false),
  setPushOptOut: jest.fn(),
  getRegisteredPushToken: jest.fn(async () => null),
  setRegisteredPushToken: jest.fn(async () => {}),
  clearRegisteredPushToken: jest.fn(async () => {}),
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(jest.fn(), {
    getState: () => mockAuthSnapshot,
  }),
}));

const mockedUseAuthStore = (
  jest.requireMock('@/stores/auth-store') as {
    useAuthStore: jest.MockedFunction<
      (selector: AuthStoreSelector) => unknown
    > & {
      getState: () => AuthStoreSnapshot;
    };
  }
).useAuthStore;

const { usePushNotifications } =
  require('./use-push-notifications') as typeof import('./use-push-notifications');

describe('usePushNotifications unresolvable merchant id tracking', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthSnapshot = { merchantId: '', user: { id: 'user-1' } };
    mockedUseAuthStore.mockImplementation((selector) =>
      selector(mockAuthSnapshot)
    );
    mockRegisterForPushNotifications.mockResolvedValue(
      'ExponentPushToken[fresh]'
    );
    mockGetStoredPushToken.mockResolvedValue(null);
    mockStoreLocalPushToken.mockResolvedValue(undefined);
  });

  it('tracks and skips server sync when no merchant id can be resolved', async () => {
    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.register();
    });

    await waitFor(() => {
      expect(mockTrackError).toHaveBeenCalledWith(
        'push_token_merchant_id_unresolvable',
        'No merchant id from explicit arg, auth store, or expo config',
        { has_storefront_constant: false }
      );
    });
    expect(mockSavePushTokenToServer).not.toHaveBeenCalled();
    expect(result.current.registeredUserId).toBe(null);
    expect(result.current.error).toBe(null);
  });
});
