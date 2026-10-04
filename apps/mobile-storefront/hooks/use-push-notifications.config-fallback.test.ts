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
const mockIsPushOptedOut = jest.fn<(userId: string) => Promise<boolean>>();

jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: 'config-merchant' },
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
  getLastNotificationResponseAsync: jest
    .fn<() => Promise<null>>()
    .mockResolvedValue(null),
}));

jest.mock('@/services/push-notifications', () => ({
  clearBadge: jest.fn(),
  handleNotificationResponse: jest.fn(),
  registerForPushNotifications: mockRegisterForPushNotifications,
  removePushTokenFromServer: jest.fn(),
  savePushTokenToServer: mockSavePushTokenToServer,
}));

jest.mock('@/services/analytics', () => ({
  trackError: jest.fn(),
}));

jest.mock('@/lib/push-token-storage', () => ({
  getStoredPushToken: mockGetStoredPushToken,
  storeLocalPushToken: mockStoreLocalPushToken,
  clearStoredPushToken: jest.fn(),
  isPushOptedOut: mockIsPushOptedOut,
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

describe('usePushNotifications merchant config fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthSnapshot = { merchantId: '', user: { id: 'user-1' } };
    mockedUseAuthStore.mockImplementation((selector) =>
      selector(mockAuthSnapshot)
    );
    mockRegisterForPushNotifications.mockResolvedValue(
      'ExponentPushToken[fresh]'
    );
    mockSavePushTokenToServer.mockResolvedValue(true);
    mockGetStoredPushToken.mockResolvedValue(null);
    mockStoreLocalPushToken.mockResolvedValue(undefined);
    mockIsPushOptedOut.mockResolvedValue(false);
  });

  it('falls back to config merchant id when auth store merchant id is empty', async () => {
    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.register();
    });

    await waitFor(() => {
      expect(mockSavePushTokenToServer).toHaveBeenCalledWith(
        'ExponentPushToken[fresh]',
        'user-1',
        'config-merchant'
      );
    });
    expect(result.current.registeredUserId).toBe('user-1');
    expect(result.current.error).toBe(null);
  });

  it('surfaces server-save failure after resolving merchant id from config', async () => {
    mockSavePushTokenToServer.mockResolvedValue(false);
    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.register();
    });

    await waitFor(() => {
      expect(mockSavePushTokenToServer).toHaveBeenCalledWith(
        'ExponentPushToken[fresh]',
        'user-1',
        'config-merchant'
      );
    });
    expect(result.current.registeredUserId).toBe(null);
    expect(result.current.error).toBe('Failed to register token with server');
  });
});
