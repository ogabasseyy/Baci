import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

type AuthSnapshot = {
  user: { id: string } | null;
  merchantId: string | null;
};

let mockAuth: AuthSnapshot;
let mockForeground: (state: AppStateStatus) => void;
const mockSave = jest.fn<Promise<boolean>, [string, string, string]>();
const mockStoredToken = jest.fn<Promise<string | null>, []>();
const mockAcquire = jest.fn<Promise<string | null>, []>();
const mockOptedOut = jest.fn<Promise<boolean>, [string]>();
let mockTelemetryExcluded = false;
const mockNativeRegistration = jest.fn();

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(
    (selector: (state: AuthSnapshot) => unknown) => selector(mockAuth),
    { getState: () => mockAuth }
  ),
}));
jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_ID: 'merchant-1' } }));
jest.mock('@/lib/storefront-telemetry-excluded', () => ({
  isStorefrontTelemetryExcluded: () => mockTelemetryExcluded,
}));
jest.mock('@/lib/hosted-staging-push-capability', () => ({
  getNativePushRegistration: () => mockNativeRegistration(),
}));
jest.mock('@/lib/push-token-storage', () => ({
  getStoredPushToken: () => mockStoredToken(),
  storeLocalPushToken: jest.fn(async () => {}),
  clearStoredPushToken: jest.fn(async () => {}),
  isPushOptedOut: (userId: string) => mockOptedOut(userId),
  setPushOptOut: jest.fn(async () => {}),
}));
jest.mock('@/services/push-notifications', () => ({
  savePushTokenToServer: (...args: [string, string, string]) =>
    mockSave(...args),
  registerForPushNotifications: () => mockAcquire(),
  removePushTokenFromServer: jest.fn(async () => true),
}));
jest.mock('@/services/push-notification-channels', () => ({
  ensureAndroidNotificationChannels: jest.fn(async () => {}),
}));
jest.mock('@/services/analytics', () => ({ trackError: jest.fn() }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
}));

const { useSavingsPushRegistration } =
  require('./use-savings-push-registration') as typeof import('./use-savings-push-registration');

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTelemetryExcluded = false;
  mockNativeRegistration.mockReturnValue({ projectId: 'isolated-project' });
  mockAuth = { user: { id: 'user-1' }, merchantId: 'merchant-1' };
  mockSave.mockReset().mockResolvedValue(true);
  mockStoredToken.mockReset().mockResolvedValue('ExponentPushToken[stored]');
  mockAcquire.mockReset().mockResolvedValue('ExponentPushToken[fresh]');
  mockOptedOut.mockReset().mockResolvedValue(false);
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      mockForeground = listener;
      return { remove: jest.fn() };
    });
});

afterEach(() => jest.restoreAllMocks());

it('registers with the isolated native capability while telemetry stays excluded', async () => {
  mockTelemetryExcluded = true;
  const { result } = renderHook(() => useSavingsPushRegistration());
  await waitFor(() => expect(result.current.isRegistered).toBe(true));
  expect(mockSave).toHaveBeenCalledTimes(1);
});

it('does not register a cached token when the native capability is unavailable', async () => {
  mockNativeRegistration.mockReturnValue(null);
  const { result } = renderHook(() => useSavingsPushRegistration());
  await act(async () => {});
  expect(mockSave).not.toHaveBeenCalled();
  expect(result.current.isRegistered).toBe(false);
});

it('shares one save between automatic registration and a foreground burst', async () => {
  const saving = deferred<boolean>();
  mockSave.mockReturnValueOnce(saving.promise);
  const { result } = renderHook(() => useSavingsPushRegistration());
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));

  act(() => {
    mockForeground('active');
    mockForeground('active');
  });
  expect(mockSave).toHaveBeenCalledTimes(1);

  await act(async () => saving.resolve(true));
  await waitFor(() => expect(result.current.isRegistered).toBe(true));
  expect(mockSave).toHaveBeenCalledTimes(1);
});

it('discards an automatic save result after logout', async () => {
  const saving = deferred<boolean>();
  mockSave.mockReturnValueOnce(saving.promise);
  const { result, rerender } = renderHook(() => useSavingsPushRegistration());
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));

  mockAuth = { user: null, merchantId: null };
  act(() => rerender(undefined));
  await act(async () => saving.resolve(true));

  expect(result.current.registeredUserId).toBeNull();
  expect(result.current.isRegistered).toBe(false);
  expect(result.current.pushToken).toBeNull();
  expect(mockSave).toHaveBeenCalledTimes(1);
});

it('drains the new account after the previous automatic save finishes', async () => {
  const saving = deferred<boolean>();
  mockSave.mockReturnValueOnce(saving.promise);
  const { result, rerender } = renderHook(() => useSavingsPushRegistration());
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));

  mockAuth = { user: { id: 'user-2' }, merchantId: 'merchant-2' };
  act(() => rerender(undefined));
  await act(async () => saving.resolve(true));

  await waitFor(() => expect(result.current.registeredUserId).toBe('user-2'));
  expect(mockSave).toHaveBeenLastCalledWith(
    'ExponentPushToken[stored]',
    'user-2',
    'merchant-2'
  );
  expect(mockSave).toHaveBeenCalledTimes(2);
});

it('registers the same user again when the merchant changes', async () => {
  const { result, rerender } = renderHook(() => useSavingsPushRegistration());
  await waitFor(() => expect(result.current.isRegistered).toBe(true));

  mockAuth = { user: { id: 'user-1' }, merchantId: 'merchant-2' };
  act(() => rerender(undefined));

  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(2));
  expect(mockSave).toHaveBeenLastCalledWith(
    'ExponentPushToken[stored]',
    'user-1',
    'merchant-2'
  );
  await waitFor(() => expect(result.current.isRegistered).toBe(true));
});

it('does not save or remain loading when authentication changes during acquisition', async () => {
  const acquiring = deferred<string>();
  mockStoredToken.mockResolvedValue(null);
  mockAcquire.mockReturnValue(acquiring.promise);
  const { result, rerender } = renderHook(() => useSavingsPushRegistration());
  let registering!: Promise<void>;
  act(() => {
    registering = result.current.register('user-1', 'merchant-1');
  });
  await waitFor(() => expect(mockAcquire).toHaveBeenCalledTimes(1));

  mockAuth = { user: { id: 'user-2' }, merchantId: 'merchant-2' };
  act(() => rerender(undefined));
  await act(async () => {
    acquiring.resolve('ExponentPushToken[late]');
    await registering;
  });

  expect(mockSave).not.toHaveBeenCalled();
  expect(result.current.pushToken).toBeNull();
  expect(result.current.isLoading).toBe(false);
});

it('does not bypass opt-out on automatic or foreground registration', async () => {
  mockOptedOut.mockResolvedValue(true);
  renderHook(() => useSavingsPushRegistration());
  await waitFor(() => expect(mockOptedOut).toHaveBeenCalled());
  await act(async () => mockForeground('active'));
  expect(mockSave).not.toHaveBeenCalled();
});
