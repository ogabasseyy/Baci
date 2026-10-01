import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

type AuthStoreSnapshot = {
  merchantId: string | null;
  user: { id: string } | null;
};

type AuthStoreSelector = (state: AuthStoreSnapshot) => unknown;

const mockNotificationListenerRemove = jest.fn();
const mockResponseListenerRemove = jest.fn();
const mockRegisterForPushNotifications =
  jest.fn<() => Promise<string | null>>();
const mockRemovePushTokenFromServer =
  jest.fn<(token: string) => Promise<boolean>>();
const mockSavePushTokenToServer =
  jest.fn<
    (token: string, userId: string, merchantId?: string) => Promise<boolean>
  >();

const mockEnsureAndroidNotificationChannels = jest.fn<() => Promise<void>>();

// push-token-storage mocks
const mockGetStoredPushToken = jest.fn<() => Promise<string | null>>();
const mockStoreLocalPushToken = jest.fn<(token: string) => Promise<void>>();
const mockClearStoredPushToken = jest.fn<() => Promise<void>>();
const mockIsPushOptedOut = jest.fn<(userId: string) => Promise<boolean>>();
const mockSetPushOptOut =
  jest.fn<(userId: string, optOut: boolean) => Promise<void>>();

jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: jest.fn(() => ({
    remove: mockNotificationListenerRemove,
  })),
  addNotificationResponseReceivedListener: jest.fn(() => ({
    remove: mockResponseListenerRemove,
  })),
  getLastNotificationResponseAsync: jest
    .fn<() => Promise<null>>()
    .mockResolvedValue(null),
}));

jest.mock('@/services/push-notification-channels', () => ({
  ensureAndroidNotificationChannels: mockEnsureAndroidNotificationChannels,
}));

jest.mock('@/services/analytics', () => ({ trackError: jest.fn() }));

jest.mock('@/services/push-notifications', () => ({
  registerForPushNotifications: mockRegisterForPushNotifications,
  removePushTokenFromServer: mockRemovePushTokenFromServer,
  savePushTokenToServer: mockSavePushTokenToServer,
}));

jest.mock('@/lib/push-token-storage', () => ({
  getStoredPushToken: mockGetStoredPushToken,
  storeLocalPushToken: mockStoreLocalPushToken,
  clearStoredPushToken: mockClearStoredPushToken,
  isPushOptedOut: mockIsPushOptedOut,
  setPushOptOut: mockSetPushOptOut,
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: jest.fn(),
}));

const mockedUseAuthStore = (
  jest.requireMock('@/stores/auth-store') as {
    useAuthStore: jest.MockedFunction<(selector: AuthStoreSelector) => unknown>;
  }
).useAuthStore;

const { usePushNotifications } =
  require('./use-push-notifications') as typeof import('./use-push-notifications');

describe('usePushNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAuthStore.mockImplementation((selector) =>
      selector({
        merchantId: 'merchant-1',
        user: { id: 'user-1' },
      })
    );
    mockRegisterForPushNotifications.mockResolvedValue(
      'ExponentPushToken[fresh]'
    );
    mockSavePushTokenToServer.mockResolvedValue(true);
    mockRemovePushTokenFromServer.mockResolvedValue(true);
    // push-token-storage defaults
    mockGetStoredPushToken.mockResolvedValue(null);
    mockStoreLocalPushToken.mockResolvedValue(undefined);
    mockClearStoredPushToken.mockResolvedValue(undefined);
    mockIsPushOptedOut.mockResolvedValue(false);
    mockSetPushOptOut.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('saves a freshly acquired token with explicit user and merchant ids', async () => {
    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.register('user-1', 'merchant-1');
    });

    await waitFor(() => {
      expect(mockSavePushTokenToServer).toHaveBeenCalledWith(
        'ExponentPushToken[fresh]',
        'user-1',
        'merchant-1'
      );
    });

    expect(result.current.isRegistered).toBe(true);
    expect(result.current.registeredUserId).toBe('user-1');
    expect(result.current.error).toBe(null);
    expect(result.current.pushToken).toBe('ExponentPushToken[fresh]');
  });

  it('ensures Android channels even when a stored token skips full registration', async () => {
    const { Platform } =
      jest.requireActual<typeof import('react-native')>('react-native');
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    try {
      mockGetStoredPushToken.mockResolvedValue('ExponentPushToken[stored]');

      const { result } = renderHook(() => usePushNotifications());
      await act(async () => {
        await result.current.register('user-1', 'merchant-1');
      });

      // The stored token short-circuits registerForPushNotifications (which
      // owns channel setup), so channels must be ensured independently or
      // upgraded installs never create newly introduced ones (e.g. payments).
      expect(mockEnsureAndroidNotificationChannels).toHaveBeenCalled();
      expect(mockRegisterForPushNotifications).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Platform, 'OS', {
        configurable: true,
        value: originalOS,
      });
    }
  });

  it('ensures Android channels on passive stored-token startup', async () => {
    const { Platform } =
      jest.requireActual<typeof import('react-native')>('react-native');
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    try {
      mockGetStoredPushToken.mockResolvedValue('ExponentPushToken[stored]');

      const { result } = renderHook(() => usePushNotifications());

      await waitFor(() =>
        expect(mockSavePushTokenToServer).toHaveBeenCalledWith(
          'ExponentPushToken[stored]',
          'user-1',
          'merchant-1'
        )
      );
      await waitFor(() => expect(result.current.isRegistered).toBe(true));
      expect(mockEnsureAndroidNotificationChannels).toHaveBeenCalled();
      expect(mockRegisterForPushNotifications).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Platform, 'OS', {
        configurable: true,
        value: originalOS,
      });
    }
  });

  it('keeps the hook unregistered when token acquisition fails', async () => {
    mockRegisterForPushNotifications.mockResolvedValue(null);

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.register('user-1', 'merchant-1');
    });

    expect(mockSavePushTokenToServer).not.toHaveBeenCalled();
    expect(result.current.isRegistered).toBe(false);
    expect(result.current.registeredUserId).toBe(null);
    expect(result.current.error).toBe('Failed to get push token');
    expect(result.current.pushToken).toBe(null);
  });

  it('keeps the hook unregistered when saving the token to the server fails', async () => {
    mockSavePushTokenToServer.mockResolvedValue(false);

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.register('user-1', 'merchant-1');
    });

    await waitFor(() => {
      expect(mockSavePushTokenToServer).toHaveBeenCalledWith(
        'ExponentPushToken[fresh]',
        'user-1',
        'merchant-1'
      );
    });

    expect(result.current.isRegistered).toBe(false);
    expect(result.current.registeredUserId).toBe(null);
    expect(result.current.error).toBe('Failed to register token with server');
    expect(result.current.pushToken).toBe('ExponentPushToken[fresh]');
  });

  it('treats registration as user-scoped when the signed-in user changes', async () => {
    const { result, rerender } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.register('user-1', 'merchant-1');
    });

    mockedUseAuthStore.mockImplementation((selector) =>
      selector({
        merchantId: 'merchant-1',
        user: { id: 'user-2' },
      })
    );

    rerender(undefined);

    expect(result.current.registeredUserId).toBe('user-1');
    expect(result.current.isRegistered).toBe(false);
  });

  // --- AsyncStorage persistence tests ---

  it('persists token to AsyncStorage after successful registration', async () => {
    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.register('user-1', 'merchant-1');
    });

    expect(mockStoreLocalPushToken).toHaveBeenCalledWith(
      'ExponentPushToken[fresh]'
    );
  });

  it('is idempotent — skips registration when already registered for current user', async () => {
    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.register('user-1', 'merchant-1');
    });

    jest.clearAllMocks();

    await act(async () => {
      await result.current.register('user-1', 'merchant-1');
    });

    expect(mockRegisterForPushNotifications).not.toHaveBeenCalled();
    expect(mockSavePushTokenToServer).not.toHaveBeenCalled();
  });

  it('reuses hydrated pushToken from state, skipping the native call', async () => {
    // Simulate hydration: mount with no stored token, but then manually hydrate
    mockGetStoredPushToken.mockResolvedValueOnce('ExponentPushToken[stored]');

    const { result } = renderHook(() => usePushNotifications());

    // Wait for hydration effect
    await waitFor(() => {
      expect(result.current.pushToken).toBe('ExponentPushToken[stored]');
    });

    await act(async () => {
      await result.current.register('user-1', 'merchant-1');
    });

    // Native call must NOT have been made — stored token was reused
    expect(mockRegisterForPushNotifications).not.toHaveBeenCalled();
    expect(mockSavePushTokenToServer).toHaveBeenCalledWith(
      'ExponentPushToken[stored]',
      'user-1',
      'merchant-1'
    );
  });

  it('falls back to getStoredPushToken() inside register() when hydration has not populated state yet', async () => {
    // No hydration effect result (returns null on mount hydration, then stored on register call)
    mockGetStoredPushToken
      .mockResolvedValueOnce(null) // hydration effect
      .mockResolvedValueOnce('ExponentPushToken[stored]'); // 3-step fallback inside register()

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.register('user-1', 'merchant-1');
    });

    expect(mockRegisterForPushNotifications).not.toHaveBeenCalled();
    expect(mockSavePushTokenToServer).toHaveBeenCalledWith(
      'ExponentPushToken[stored]',
      'user-1',
      'merchant-1'
    );
  });

  it('returns early without registering when user has opted out', async () => {
    mockIsPushOptedOut.mockResolvedValue(true);

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.register('user-1', 'merchant-1');
    });

    expect(mockRegisterForPushNotifications).not.toHaveBeenCalled();
    expect(mockSavePushTokenToServer).not.toHaveBeenCalled();
  });

  it('clears opt-out flag and proceeds when force: true is passed', async () => {
    mockIsPushOptedOut.mockResolvedValue(true);

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.register('user-1', 'merchant-1', { force: true });
    });

    expect(mockSetPushOptOut).toHaveBeenCalledWith('user-1', false);
    expect(mockRegisterForPushNotifications).toHaveBeenCalled();
  });

  it('hydrates token from AsyncStorage on mount without setting registeredUserId', async () => {
    // Unauthenticated user — token is loaded from storage but cannot be synced
    // to server yet (no userId). registeredUserId must stay null.
    mockedUseAuthStore.mockImplementation((selector) =>
      selector({ merchantId: null, user: null })
    );
    mockGetStoredPushToken.mockResolvedValue('ExponentPushToken[hydrated]');

    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => {
      expect(result.current.pushToken).toBe('ExponentPushToken[hydrated]');
    });

    // registeredUserId must stay null until server confirms
    expect(result.current.registeredUserId).toBeNull();
    expect(result.current.isRegistered).toBe(false);
  });

  it('stays unregistered on mount when no token is stored', async () => {
    mockGetStoredPushToken.mockResolvedValue(null);

    const { result } = renderHook(() => usePushNotifications());

    // Give hydration effect time to settle
    await act(async () => {
      // flush promises
    });

    expect(result.current.pushToken).toBeNull();
    expect(result.current.registeredUserId).toBeNull();
    expect(result.current.isRegistered).toBe(false);
  });

  // --- unregister() tests ---

  it('uses AsyncStorage token as fallback in unregister() when pushToken state is null', async () => {
    mockGetStoredPushToken.mockResolvedValue('ExponentPushToken[stored]');

    // Start with no in-memory token (never registered in this session)
    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.unregister();
    });

    expect(mockRemovePushTokenFromServer).toHaveBeenCalledWith(
      'ExponentPushToken[stored]'
    );
    expect(mockClearStoredPushToken).toHaveBeenCalled();
  });

  it('clears AsyncStorage, sets per-user opt-out, and deactivates server token on unregister()', async () => {
    const { result } = renderHook(() => usePushNotifications());

    // First register so pushToken is in state
    await act(async () => {
      await result.current.register('user-1', 'merchant-1');
    });

    jest.clearAllMocks();

    await act(async () => {
      await result.current.unregister();
    });

    expect(mockClearStoredPushToken).toHaveBeenCalled();
    expect(mockSetPushOptOut).toHaveBeenCalledWith('user-1', true);
    expect(mockRemovePushTokenFromServer).toHaveBeenCalledWith(
      'ExponentPushToken[fresh]'
    );
    expect(result.current.pushToken).toBeNull();
    expect(result.current.registeredUserId).toBeNull();
  });

  it('awaits removePushTokenFromServer() before unregister() resolves', async () => {
    let resolveRemove!: (val: boolean) => void;
    const removePromise = new Promise<boolean>((res) => {
      resolveRemove = res;
    });
    mockRemovePushTokenFromServer.mockReturnValue(removePromise);

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.register('user-1', 'merchant-1');
    });

    jest.clearAllMocks();
    mockRemovePushTokenFromServer.mockReturnValue(removePromise);

    let unregisterDone = false;
    const unregisterPromise = act(async () => {
      await result.current.unregister();
      unregisterDone = true;
    });

    // Before resolving the server call, unregister should not be done
    expect(unregisterDone).toBe(false);

    resolveRemove(true);
    await unregisterPromise;

    expect(unregisterDone).toBe(true);
  });

  // --- sign-out transition effect tests ---

  it('clears pushToken and registeredUserId when user transitions from non-null to null', async () => {
    const { result, rerender } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.register('user-1', 'merchant-1');
    });

    expect(result.current.pushToken).toBe('ExponentPushToken[fresh]');
    expect(result.current.registeredUserId).toBe('user-1');

    // Simulate sign-out
    mockedUseAuthStore.mockImplementation((selector) =>
      selector({ merchantId: null, user: null })
    );

    act(() => {
      rerender(undefined);
    });

    expect(result.current.pushToken).toBeNull();
    expect(result.current.registeredUserId).toBeNull();
  });

  it('does not fire sign-out effect on initial mount when user starts as null', async () => {
    mockedUseAuthStore.mockImplementation((selector) =>
      selector({ merchantId: null, user: null })
    );

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      // flush promises
    });

    // Should not have tried to clear anything
    expect(mockClearStoredPushToken).not.toHaveBeenCalled();
    expect(result.current.pushToken).toBeNull();
    expect(result.current.registeredUserId).toBeNull();
  });
});
