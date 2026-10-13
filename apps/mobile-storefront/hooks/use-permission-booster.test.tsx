import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { NotificationPermissionsStatus } from 'expo-notifications';

const mockNotificationsModuleLoad = jest.fn();
const grantedPermissionStatus: NotificationPermissionsStatus = {
  status: 'granted' as NotificationPermissionsStatus['status'],
  expires: 'never',
  granted: true,
  canAskAgain: true,
};
const mockGetPermissionsAsync = jest
  .fn<() => Promise<NotificationPermissionsStatus>>()
  .mockResolvedValue(grantedPermissionStatus);
const mockRequestPermissionsAsync = jest
  .fn<() => Promise<NotificationPermissionsStatus>>()
  .mockResolvedValue(grantedPermissionStatus);
let mockRejectNextNotificationsModuleLoad = false;

function createBareThenable<T>(value: T): PromiseLike<T> {
  return {
    // Intentional: this models Expo SDK 57's native asyncRequire thenable.
    // biome-ignore lint/suspicious/noThenProperty: regression fixture for Expo's bare thenable
    then<TResult1 = T, TResult2 = never>(
      onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
      _onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null
    ): PromiseLike<TResult1 | TResult2> {
      if (!onfulfilled) {
        return Promise.resolve(value) as PromiseLike<TResult1 | TResult2>;
      }
      return Promise.resolve(onfulfilled(value));
    },
  };
}

jest.mock('expo-notifications', () => {
  mockNotificationsModuleLoad();
  if (mockRejectNextNotificationsModuleLoad) {
    mockRejectNextNotificationsModuleLoad = false;
    throw new Error('notification module unavailable');
  }
  return {
    getPermissionsAsync: mockGetPermissionsAsync,
    requestPermissionsAsync: mockRequestPermissionsAsync,
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRejectNextNotificationsModuleLoad = false;
  mockGetPermissionsAsync.mockResolvedValue(grantedPermissionStatus);
  mockRequestPermissionsAsync.mockResolvedValue(grantedPermissionStatus);
  jest.useRealTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('usePermissionBooster native module loading', () => {
  it('does not load expo-notifications on module initialization', async () => {
    await import('./use-permission-booster');

    expect(mockNotificationsModuleLoad).not.toHaveBeenCalled();
  });

  it('resolves an Expo SDK 57 bare thenable without Promise catch methods', async () => {
    const { loadNotificationsModule } = await import(
      './use-permission-booster'
    );
    const notifications = {
      getPermissionsAsync: mockGetPermissionsAsync,
      requestPermissionsAsync: mockRequestPermissionsAsync,
    };
    const thenable = createBareThenable(notifications);

    expect((thenable as { catch?: unknown }).catch).toBeUndefined();
    expect((thenable as { finally?: unknown }).finally).toBeUndefined();

    await expect(loadNotificationsModule(() => thenable)).resolves.toEqual(
      notifications
    );
  });

  it('retries after a native notification loader throws synchronously', async () => {
    await jest.isolateModulesAsync(async () => {
      const { loadNotifications } = await import('./use-permission-booster');
      const notifications = {
        getPermissionsAsync: mockGetPermissionsAsync,
        requestPermissionsAsync: mockRequestPermissionsAsync,
      };
      const synchronousFailure = jest.fn<
        () => PromiseLike<typeof notifications>
      >(() => {
        throw new TypeError('native asyncRequire failed');
      });
      const successfulLoad = jest
        .fn<() => PromiseLike<typeof notifications>>()
        .mockReturnValue(Promise.resolve(notifications));
      const warnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);

      await expect(loadNotifications(synchronousFailure)).resolves.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        'Notification permission API failed:',
        'expo-notifications',
        expect.any(TypeError)
      );

      await expect(loadNotifications(successfulLoad)).resolves.toEqual(
        notifications
      );
      expect(synchronousFailure).toHaveBeenCalledTimes(1);
      expect(successfulLoad).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });
  });

  it('falls back to denied when expo-notifications cannot load and retries later', async () => {
    mockRejectNextNotificationsModuleLoad = true;
    const { usePermissionBooster } = await import('./use-permission-booster');
    const { result } = renderHook(() => usePermissionBooster());
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    let firstPermissionResult:
      | 'granted'
      | 'denied'
      | 'soft-ask-needed'
      | undefined;
    let secondPermissionResult:
      | 'granted'
      | 'denied'
      | 'soft-ask-needed'
      | undefined;

    expect(mockNotificationsModuleLoad).not.toHaveBeenCalled();

    await act(async () => {
      firstPermissionResult =
        await result.current.requestPermission('notifications');
    });

    expect(firstPermissionResult).toBe('denied');
    expect(warnSpy).toHaveBeenCalledWith(
      'Notification permission API failed:',
      'expo-notifications',
      expect.any(Error)
    );
    warnSpy.mockRestore();

    await act(async () => {
      secondPermissionResult =
        await result.current.requestPermission('notifications');
    });

    expect(secondPermissionResult).toBe('granted');
    expect(mockNotificationsModuleLoad).toHaveBeenCalledTimes(2);
    expect(mockGetPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('returns null instead of throwing when notification permission APIs are unavailable', async () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const { getNotificationPermissionStatus } = await import(
      './use-permission-booster'
    );

    await expect(getNotificationPermissionStatus({})).resolves.toBeNull();
    expect(mockGetPermissionsAsync).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'Notification permission API unavailable:',
      'getPermissionsAsync'
    );
  });

  it('returns null instead of throwing when notification permission status calls fail', async () => {
    const permissionError = new TypeError('undefined is not a function');
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const { getNotificationPermissionStatus } = await import(
      './use-permission-booster'
    );
    const getPermissionsAsync = () => Promise.reject(permissionError);

    await expect(
      getNotificationPermissionStatus({
        getPermissionsAsync,
      })
    ).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      'Notification permission API failed:',
      'getPermissionsAsync',
      permissionError
    );
  });

  it('returns false instead of throwing when notification request APIs are unavailable', async () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const { requestNotificationPermissionStatus } = await import(
      './use-permission-booster'
    );

    await expect(requestNotificationPermissionStatus({})).resolves.toBe(false);
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'Notification permission API unavailable:',
      'requestPermissionsAsync'
    );
  });

  it('returns false instead of throwing when notification permission request calls fail', async () => {
    const permissionError = new TypeError('undefined is not a function');
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const { requestNotificationPermissionStatus } = await import(
      './use-permission-booster'
    );
    const requestPermissionsAsync = () => Promise.reject(permissionError);

    await expect(
      requestNotificationPermissionStatus({
        requestPermissionsAsync,
      })
    ).resolves.toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      'Notification permission API failed:',
      'requestPermissionsAsync',
      permissionError
    );
  });
});
