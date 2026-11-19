import { act, renderHook } from '@testing-library/react-native';
import { Keyboard } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import { useDeferredKeyboardPreload } from './useDeferredKeyboardPreload';

const originalRequestIdleCallback = global.requestIdleCallback;
const originalCancelIdleCallback = global.cancelIdleCallback;
const originalRequestAnimationFrame = global.requestAnimationFrame;
const originalCancelAnimationFrame = global.cancelAnimationFrame;

describe('useDeferredKeyboardPreload', () => {
  let pendingIdleCallback: (() => void) | undefined;
  let nextFrameId = 0;
  let pendingFrames: Map<number, FrameRequestCallback>;
  const cancelIdleCallbackMock = jest.fn();

  const flushNextAnimationFrameBatch = () => {
    const batch = [...pendingFrames.entries()];
    pendingFrames.clear();
    for (const [, callback] of batch) {
      callback(0);
    }
  };

  const flushAnimationFrames = () => {
    while (pendingFrames.size > 0) {
      flushNextAnimationFrameBatch();
    }
  };

  const mockKeyboardListeners = () => {
    const listeners: Record<string, () => void> = {};
    const addListenerSpy = jest
      .spyOn(Keyboard, 'addListener')
      .mockImplementation(((event: string, cb: () => void) => {
        listeners[event] = cb;
        return {
          remove: jest.fn(),
        } as unknown as ReturnType<typeof Keyboard.addListener>;
      }) as typeof Keyboard.addListener);
    return { listeners, addListenerSpy };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    pendingIdleCallback = undefined;
    nextFrameId = 0;
    pendingFrames = new Map();
    (KeyboardController.isVisible as jest.Mock).mockReturnValue(false);
    global.requestAnimationFrame = jest.fn((callback) => {
      const id = ++nextFrameId;
      pendingFrames.set(id, callback);
      return id;
    });
    global.cancelAnimationFrame = jest.fn((id) => {
      if (typeof id === 'number') pendingFrames.delete(id);
    });
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
    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('does not schedule preload before startup is ready', () => {
    renderHook(() => useDeferredKeyboardPreload(false));

    expect(global.requestAnimationFrame).not.toHaveBeenCalled();
    expect(global.requestIdleCallback).not.toHaveBeenCalled();
    expect(KeyboardController.preload).not.toHaveBeenCalled();
  });

  it('schedules preload on idle only after two post-ready frames commit', async () => {
    const { rerender } = renderHook(
      ({ ready }: { ready: boolean }) => useDeferredKeyboardPreload(ready),
      { initialProps: { ready: false } }
    );

    rerender({ ready: true });
    expect(global.requestIdleCallback).not.toHaveBeenCalled();

    act(() => flushNextAnimationFrameBatch());
    expect(global.requestIdleCallback).not.toHaveBeenCalled();

    act(() => flushNextAnimationFrameBatch());
    expect(global.requestIdleCallback).toHaveBeenCalledWith(
      expect.any(Function)
    );

    await act(async () => pendingIdleCallback?.());
    expect(KeyboardController.preload).toHaveBeenCalledTimes(1);
  });

  it('skips scheduling when the keyboard is already visible', () => {
    (KeyboardController.isVisible as jest.Mock).mockReturnValueOnce(true);

    renderHook(() => useDeferredKeyboardPreload(true));

    expect(global.requestAnimationFrame).not.toHaveBeenCalled();
    expect(global.requestIdleCallback).not.toHaveBeenCalled();
    expect(KeyboardController.preload).not.toHaveBeenCalled();
  });

  it('skips preload when the keyboard opened before startup became ready', () => {
    const { listeners, addListenerSpy } = mockKeyboardListeners();
    try {
      const { rerender } = renderHook(
        ({ ready }: { ready: boolean }) => useDeferredKeyboardPreload(ready),
        { initialProps: { ready: false } }
      );

      act(() => listeners.keyboardWillShow?.());
      rerender({ ready: true });
      act(() => flushAnimationFrames());

      expect(global.requestIdleCallback).not.toHaveBeenCalled();
      expect(KeyboardController.preload).not.toHaveBeenCalled();
    } finally {
      addListenerSpy.mockRestore();
    }
  });

  it('cancels pending preload when keyboardWillShow fires', async () => {
    const { listeners, addListenerSpy } = mockKeyboardListeners();
    try {
      renderHook(() => useDeferredKeyboardPreload(true));
      act(() => flushAnimationFrames());
      const lateCallback = pendingIdleCallback;

      act(() => listeners.keyboardWillShow?.());
      expect(cancelIdleCallbackMock).toHaveBeenCalledWith(1);

      await act(async () => lateCallback?.());
      expect(KeyboardController.preload).not.toHaveBeenCalled();
    } finally {
      addListenerSpy.mockRestore();
    }
  });

  it('cancels pending preload on unmount', async () => {
    const { unmount } = renderHook(() => useDeferredKeyboardPreload(true));
    act(() => flushAnimationFrames());
    const lateCallback = pendingIdleCallback;

    unmount();
    expect(cancelIdleCallbackMock).toHaveBeenCalledWith(1);

    await act(async () => lateCallback?.());
    expect(KeyboardController.preload).not.toHaveBeenCalled();
  });

  it('does not preload when requestIdleCallback is unavailable', () => {
    jest.useFakeTimers({
      doNotFake: ['requestAnimationFrame', 'cancelAnimationFrame'],
    });
    Object.defineProperty(global, 'requestIdleCallback', {
      configurable: true,
      value: undefined,
    });

    renderHook(() => useDeferredKeyboardPreload(true));
    act(() => flushAnimationFrames());

    act(() => jest.runAllTimers());
    expect(KeyboardController.preload).not.toHaveBeenCalled();
  });
});
