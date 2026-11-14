import { act, renderHook, waitFor } from '@testing-library/react-native';
import SplashMotion from 'react-native-splash-motion';
import { useNativeSplashHandoff } from './use-native-splash-handoff';

jest.mock('react-native-splash-motion', () => ({
  __esModule: true,
  default: { hide: jest.fn(), isVisible: jest.fn() },
}));
jest.mock('@/lib/crash-diagnostics', () => ({
  recordCrashBreadcrumb: jest.fn(),
}));
jest.mock('@/lib/startup-timing', () => ({ markStartupTiming: jest.fn() }));
jest.mock('./splash-constants', () => ({
  SPLASH_TIMEOUT_MS: 8_000,
}));
jest.mock('./use-native-splash-intro', () => ({
  useNativeSplashIntro: () => ({ settled: false, completed: false }),
}));

beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(SplashMotion.hide).mockResolvedValue(undefined);
  jest.mocked(SplashMotion.isVisible).mockReturnValue(true);
});

afterEach(() => jest.useRealTimers());

it('hides the native splash when the startup deadline expires before intro settles', async () => {
  const { result } = renderHook(() =>
    useNativeSplashHandoff({ initialVisible: true, ready: false })
  );

  await act(async () => jest.advanceTimersByTime(8_000));

  expect(result.current.timedOut).toBe(true);
  await waitFor(() => expect(SplashMotion.hide).toHaveBeenCalledTimes(1));
  expect(SplashMotion.hide).toHaveBeenCalledWith({
    waitForLoop: false,
    minDuration: 0,
    fade: 220,
  });
});

it('waits for the native watchdog to release the overlay before showing recovery', async () => {
  jest
    .mocked(SplashMotion.hide)
    .mockReturnValue(new Promise<void>(() => undefined));
  const isVisible = jest.mocked(SplashMotion.isVisible);
  const { result } = renderHook(() =>
    useNativeSplashHandoff({ initialVisible: true, ready: false })
  );

  await act(async () => jest.advanceTimersByTime(8_000));

  expect(result.current.timedOut).toBe(true);
  expect(result.current.nativeSplashVisible).toBe(true);
  isVisible.mockReturnValue(false);
  await act(async () => jest.advanceTimersByTime(1000));
  expect(result.current.nativeSplashVisible).toBe(false);
});

it('stops native visibility polling after a timeout hide succeeds', async () => {
  const isVisible = jest.mocked(SplashMotion.isVisible);
  const { result } = renderHook(() =>
    useNativeSplashHandoff({ initialVisible: true, ready: false })
  );

  await act(async () => jest.advanceTimersByTime(8_000));
  await waitFor(() => expect(result.current.showSplash).toBe(false));
  const visibilityReadsAfterHide = isVisible.mock.calls.length;

  await act(async () => jest.advanceTimersByTime(3_000));

  expect(isVisible).toHaveBeenCalledTimes(visibilityReadsAfterHide);
});

it('clears native visibility polling when the hook unmounts during recovery', async () => {
  jest
    .mocked(SplashMotion.hide)
    .mockRejectedValue(new Error('native hide failed'));
  const isVisible = jest.mocked(SplashMotion.isVisible);
  const { unmount } = renderHook(() =>
    useNativeSplashHandoff({ initialVisible: true, ready: false })
  );

  await act(async () => jest.advanceTimersByTime(8_000));
  await waitFor(() => expect(isVisible).toHaveBeenCalled());
  const visibilityReadsBeforeUnmount = isVisible.mock.calls.length;
  unmount();

  await act(async () => jest.advanceTimersByTime(3_000));

  expect(isVisible).toHaveBeenCalledTimes(visibilityReadsBeforeUnmount);
});
