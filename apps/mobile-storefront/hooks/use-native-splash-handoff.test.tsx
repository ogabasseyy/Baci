import { act, renderHook, waitFor } from '@testing-library/react-native';
import SplashMotion from 'react-native-splash-motion';
import { markStartupTiming } from '@/lib/startup-timing';
import { useNativeSplashHandoff } from './use-native-splash-handoff';

jest.mock('react-native-splash-motion', () => ({
  __esModule: true,
  default: { hide: jest.fn(), waitForIntro: jest.fn() },
}));
jest.mock('@/lib/crash-diagnostics', () => ({
  recordCrashBreadcrumb: jest.fn(),
}));
jest.mock('@/lib/startup-timing', () => ({ markStartupTiming: jest.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const mockHide = jest.mocked(SplashMotion.hide);
const mockWaitForIntro = jest.fn<Promise<boolean>, []>();
let intro: ReturnType<typeof deferred<boolean>>;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  intro = deferred<boolean>();
  mockWaitForIntro.mockReturnValue(intro.promise);
  Object.defineProperty(SplashMotion, 'waitForIntro', {
    value: mockWaitForIntro,
    configurable: true,
    writable: true,
  });
  mockHide.mockResolvedValue(undefined);
});

afterEach(() => jest.useRealTimers());

it('keeps the heavy app tree unmounted until native playback actually ends', async () => {
  const { result, rerender } = renderHook(
    ({ ready }: { ready: boolean }) =>
      useNativeSplashHandoff({ initialVisible: true, ready }),
    { initialProps: { ready: false } }
  );
  expect(result.current.shouldRenderApp).toBe(false);
  rerender({ ready: true });
  expect(mockWaitForIntro).toHaveBeenCalledTimes(1);
  expect(mockHide).not.toHaveBeenCalled();

  // A placeholder's layout must not stand in for the real app's layout.
  act(() => result.current.onFirstLayout());
  await act(async () => intro.resolve(true));
  expect(result.current.shouldRenderApp).toBe(true);
  expect(mockHide).not.toHaveBeenCalled();
});

it('holds the final scene until the app has laid out, then fades without another loop', async () => {
  const hide = deferred<void>();
  mockHide.mockReturnValue(hide.promise);
  const { result } = renderHook(() =>
    useNativeSplashHandoff({ initialVisible: true, ready: true })
  );
  await act(async () => intro.resolve(true));
  act(() => result.current.onFirstLayout());
  await waitFor(() =>
    expect(mockHide).toHaveBeenCalledWith({
      waitForLoop: false,
      minDuration: 0,
      fade: 220,
    })
  );
  expect(result.current.showSplash).toBe(true);
  await act(async () => hide.resolve(undefined));
  expect(result.current.showSplash).toBe(false);
});

it('keeps holding after intro and layout while initialization is not ready', async () => {
  const { result, rerender } = renderHook(
    ({ ready }: { ready: boolean }) =>
      useNativeSplashHandoff({ initialVisible: true, ready }),
    { initialProps: { ready: false } }
  );
  await act(async () => intro.resolve(true));
  act(() => result.current.onFirstLayout());
  expect(mockHide).not.toHaveBeenCalled();
  expect(result.current.showSplash).toBe(true);
  rerender({ ready: true });
  await waitFor(() => expect(mockHide).toHaveBeenCalledTimes(1));
});

it('does not let the JS readiness timeout cut a still-playing intro short', async () => {
  const { result } = renderHook(() =>
    useNativeSplashHandoff({ initialVisible: true, ready: false })
  );
  act(() => jest.advanceTimersByTime(8000));
  expect(result.current.shouldRenderApp).toBe(false);
  expect(mockHide).not.toHaveBeenCalled();
  await act(async () => intro.resolve(true));
  act(() => result.current.onFirstLayout());
  await waitFor(() =>
    expect(mockHide).toHaveBeenCalledWith({
      waitForLoop: false,
      minDuration: 0,
      fade: 220,
    })
  );
});

it('releases rendering safely if the native intro API fails', async () => {
  const { result } = renderHook(() =>
    useNativeSplashHandoff({ initialVisible: true, ready: true })
  );
  await act(async () => intro.reject(new Error('older native build')));
  expect(result.current.shouldRenderApp).toBe(true);
  act(() => result.current.onFirstLayout());
  await waitFor(() =>
    expect(mockHide).toHaveBeenCalledWith({
      waitForLoop: true,
      minDuration: 2500,
      fade: 220,
    })
  );
});

it('does not wait on native playback during an already completed boot', () => {
  const { result } = renderHook(() =>
    useNativeSplashHandoff({ initialVisible: false, ready: true })
  );
  expect(result.current.shouldRenderApp).toBe(true);
  expect(mockWaitForIntro).not.toHaveBeenCalled();
  expect(mockHide).not.toHaveBeenCalled();
});

it('ignores late intro completion after unmount', async () => {
  const { unmount } = renderHook(() =>
    useNativeSplashHandoff({ initialVisible: true, ready: true })
  );
  unmount();
  await act(async () => intro.resolve(true));
  expect(markStartupTiming).not.toHaveBeenCalledWith('native_intro_completed');
  expect(mockHide).not.toHaveBeenCalled();
});
