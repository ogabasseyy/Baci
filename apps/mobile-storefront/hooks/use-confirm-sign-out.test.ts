import { act, renderHook } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { useConfirmSignOut } from './use-confirm-sign-out';

jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

const originalIdle = global.requestIdleCallback;
const originalCancel = global.cancelIdleCallback;
let pending: (() => void) | undefined;
const cancel = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  pending = undefined;
  global.requestIdleCallback = jest.fn((callback) => {
    pending = () => callback({ didTimeout: false, timeRemaining: () => 50 });
    return 1;
  });
  global.cancelIdleCallback = cancel;
});

afterEach(() => {
  global.requestIdleCallback = originalIdle;
  global.cancelIdleCallback = originalCancel;
  jest.restoreAllMocks();
});

it('defers sign out until idle and redirects after success', async () => {
  const signOut = jest.fn(async () => undefined);
  const { result } = renderHook(() => useConfirmSignOut(signOut));
  act(() => result.current());
  expect(signOut).not.toHaveBeenCalled();
  await act(async () => pending?.());
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(router.replace).toHaveBeenCalledWith('/');
});

it('offers retry after rejection and does not redirect', async () => {
  const failure = new Error('offline');
  const signOut = jest
    .fn()
    .mockRejectedValueOnce(failure)
    .mockResolvedValue(undefined);
  const alert = jest.spyOn(Alert, 'alert');
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const { result } = renderHook(() => useConfirmSignOut(signOut));
  act(() => result.current());
  await act(async () => pending?.());
  expect(router.replace).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(
    'Sign Out Failed',
    expect.any(String),
    expect.any(Array)
  );
  const retry = alert.mock.calls[0]?.[2]?.find(
    (button) => button.text === 'Retry'
  );
  act(() => retry?.onPress?.());
  await act(async () => pending?.());
  expect(signOut).toHaveBeenCalledTimes(2);
  expect(router.replace).toHaveBeenCalledWith('/');
});

it('cancels scheduled sign out on unmount and ignores a late callback', async () => {
  const signOut = jest.fn(async () => undefined);
  const { result, unmount } = renderHook(() => useConfirmSignOut(signOut));
  act(() => result.current());
  const lateCallback = pending;
  unmount();
  expect(cancel).toHaveBeenCalledWith(1);
  await act(async () => lateCallback?.());
  expect(signOut).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
});

it('does not navigate after an in-flight sign out resolves following unmount', async () => {
  let finish: (() => void) | undefined;
  const signOut = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const { result, unmount } = renderHook(() => useConfirmSignOut(signOut));
  act(() => result.current());
  act(() => pending?.());
  unmount();
  await act(async () => finish?.());
  expect(router.replace).not.toHaveBeenCalled();
});
