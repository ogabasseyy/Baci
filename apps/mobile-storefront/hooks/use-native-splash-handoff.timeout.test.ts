import { act, renderHook, waitFor } from '@testing-library/react-native';
import SplashMotion from 'react-native-splash-motion';
import { useNativeSplashHandoff } from './use-native-splash-handoff';

jest.mock('react-native-splash-motion', () => ({
  __esModule: true,
  default: { hide: jest.fn() },
}));
jest.mock('@/lib/crash-diagnostics', () => ({
  recordCrashBreadcrumb: jest.fn(),
}));
jest.mock('@/lib/startup-timing', () => ({ markStartupTiming: jest.fn() }));
jest.mock('./use-native-splash-intro', () => ({
  SPLASH_TIMEOUT_MS: 8_000,
  useNativeSplashIntro: () => ({ settled: false, completed: false }),
}));

beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(SplashMotion.hide).mockResolvedValue(undefined);
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
