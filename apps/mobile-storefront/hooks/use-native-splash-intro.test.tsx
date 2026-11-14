import { act, renderHook } from '@testing-library/react-native';
import SplashMotion from 'react-native-splash-motion';
import { recordCrashBreadcrumb } from '@/lib/crash-diagnostics';
import { markStartupTiming } from '@/lib/startup-timing';
import { useNativeSplashIntro } from './use-native-splash-intro';

jest.mock('react-native-splash-motion', () => ({
  __esModule: true,
  default: { waitForIntro: jest.fn() },
}));
jest.mock('@/lib/crash-diagnostics', () => ({
  recordCrashBreadcrumb: jest.fn(),
}));
jest.mock('@/lib/startup-timing', () => ({ markStartupTiming: jest.fn() }));
const wait = jest.fn<Promise<boolean>, []>();
beforeEach(() => {
  jest.clearAllMocks();
  wait.mockReset();
  Object.defineProperty(SplashMotion, 'waitForIntro', {
    value: wait,
    writable: true,
    configurable: true,
  });
});
it('does not wait when the native intro is not visible', () => {
  const { result } = renderHook(() => useNativeSplashIntro(false));
  expect(result.current).toEqual({ settled: true, completed: false });
  expect(wait).not.toHaveBeenCalled();
});
it.each([
  true,
  false,
])('settles with native completion %s', async (completed) => {
  let resolve!: (value: boolean) => void;
  wait.mockReturnValue(
    new Promise<boolean>((accept) => {
      resolve = accept;
    })
  );
  const { result } = renderHook(() => useNativeSplashIntro(true));
  expect(result.current.settled).toBe(false);
  await act(async () => resolve(completed));
  expect(result.current).toEqual({ settled: true, completed });
  expect(markStartupTiming).toHaveBeenCalledWith(
    completed ? 'native_intro_completed' : 'native_intro_skipped'
  );
});
it('settles safely when the native API is unavailable', async () => {
  Object.defineProperty(SplashMotion, 'waitForIntro', { value: undefined });
  const { result } = renderHook(() => useNativeSplashIntro(true));
  await act(async () => {});
  expect(result.current).toEqual({ settled: true, completed: false });
  expect(recordCrashBreadcrumb).toHaveBeenCalledWith(
    'root_layout:native_intro_api_unavailable'
  );
});
it.each(['throw', 'reject'])('settles safely on native %s', async (mode) => {
  wait.mockImplementation(() => {
    if (mode === 'throw') throw new Error('native failure');
    return Promise.reject(new Error('native failure'));
  });
  const { result } = renderHook(() => useNativeSplashIntro(true));
  await act(async () => {});
  expect(result.current).toEqual({ settled: true, completed: false });
  expect(recordCrashBreadcrumb).toHaveBeenCalledWith(
    'root_layout:native_intro_wait_failed'
  );
});
it.each([
  'resolve',
  'reject',
])('ignores late %s after unmount', async (mode) => {
  let resolve!: (value: boolean) => void;
  let reject!: (error: Error) => void;
  wait.mockReturnValue(
    new Promise<boolean>((accept, fail) => {
      resolve = accept;
      reject = fail;
    })
  );
  const { unmount } = renderHook(() => useNativeSplashIntro(true));
  unmount();
  await act(async () => {
    if (mode === 'resolve') resolve(true);
    else reject(new Error('late failure'));
  });
  expect(markStartupTiming).not.toHaveBeenCalled();
  expect(recordCrashBreadcrumb).not.toHaveBeenCalled();
});
