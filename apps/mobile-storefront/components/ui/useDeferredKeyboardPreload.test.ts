import { act, renderHook } from '@testing-library/react-native';
import { Keyboard } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import { useDeferredKeyboardPreload } from './useDeferredKeyboardPreload';

const originalRequestIdleCallback = global.requestIdleCallback;
const originalCancelIdleCallback = global.cancelIdleCallback;

describe('useDeferredKeyboardPreload', () => {
  let pendingIdleCallback: (() => void) | undefined;
  const cancelIdleCallbackMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    pendingIdleCallback = undefined;
    (KeyboardController.isVisible as jest.Mock).mockReturnValue(false);
    global.requestIdleCallback = jest.fn((callback) => {
      pendingIdleCallback = () =>
        callback({ didTimeout: false, timeRemaining: () => 50 });
      return 1;
    });
    global.cancelIdleCallback = cancelIdleCallbackMock;
  });

  afterEach(() => {
    jest.useRealTimers();
    global.requestIdleCallback = originalRequestIdleCallback;
    global.cancelIdleCallback = originalCancelIdleCallback;
  });

  it('does not schedule preload before startup is ready', () => {
    renderHook(() => useDeferredKeyboardPreload(false));

    expect(global.requestIdleCallback).not.toHaveBeenCalled();
    expect(KeyboardController.preload).not.toHaveBeenCalled();
  });

  it('schedules preload on idle after startup becomes ready', async () => {
    const { rerender } = renderHook(
      ({ ready }: { ready: boolean }) => useDeferredKeyboardPreload(ready),
      { initialProps: { ready: false } }
    );

    rerender({ ready: true });
    expect(global.requestIdleCallback).toHaveBeenCalledWith(
      expect.any(Function),
      { timeout: 1200 }
    );

    await act(async () => pendingIdleCallback?.());
    expect(KeyboardController.preload).toHaveBeenCalledTimes(1);
  });

  it('skips scheduling when the keyboard is already visible', () => {
    (KeyboardController.isVisible as jest.Mock).mockReturnValueOnce(true);

    renderHook(() => useDeferredKeyboardPreload(true));

    expect(global.requestIdleCallback).not.toHaveBeenCalled();
    expect(KeyboardController.preload).not.toHaveBeenCalled();
  });

  it('cancels pending preload when keyboardWillShow fires and on unmount', async () => {
    const listeners: Record<string, () => void> = {};
    const addListenerSpy = jest
      .spyOn(Keyboard, 'addListener')
      .mockImplementation(((event: string, cb: () => void) => {
        listeners[event] = cb;
        return { remove: jest.fn() };
      }) as never);

    const { unmount } = renderHook(() => useDeferredKeyboardPreload(true));
    const lateCallback = pendingIdleCallback;

    act(() => listeners.keyboardWillShow?.());
    expect(cancelIdleCallbackMock).toHaveBeenCalledWith(1);

    await act(async () => lateCallback?.());
    expect(KeyboardController.preload).not.toHaveBeenCalled();

    unmount();
    addListenerSpy.mockRestore();
  });

  it('falls back to a delayed timeout when requestIdleCallback is unavailable', () => {
    jest.useFakeTimers();
    Object.defineProperty(global, 'requestIdleCallback', {
      configurable: true,
      value: undefined,
    });

    renderHook(() => useDeferredKeyboardPreload(true));

    act(() => jest.advanceTimersByTime(249));
    expect(KeyboardController.preload).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(1));
    expect(KeyboardController.preload).toHaveBeenCalledTimes(1);
  });
});
