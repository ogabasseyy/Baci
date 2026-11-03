import { jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import type { RefObject } from 'react';
import type { ScrollViewInstance } from 'react-native';
import { SPACING } from '@/constants/Colors';
import { useNextStepScroll } from './use-next-step-scroll';

const originalIdle = global.requestIdleCallback;
const originalCancelIdle = global.cancelIdleCallback;
const idleCallbacks = new Map<number, () => void>();
const mockRequestIdle = jest.fn<typeof requestIdleCallback>();
const mockCancelIdle = jest.fn<typeof cancelIdleCallback>();

type FrameCallback = Parameters<typeof requestAnimationFrame>[0];

describe('useNextStepScroll', () => {
  let frameCallbacks: Map<number, FrameCallback>;
  let nextFrameId: number;

  beforeEach(() => {
    jest.clearAllMocks();
    frameCallbacks = new Map();
    nextFrameId = 1;
    jest
      .spyOn(global, 'requestAnimationFrame')
      .mockImplementation((callback: FrameCallback) => {
        const frameId = nextFrameId;
        nextFrameId += 1;
        frameCallbacks.set(frameId, callback);
        return frameId;
      });
    jest.spyOn(global, 'cancelAnimationFrame').mockImplementation((frameId) => {
      if (typeof frameId === 'number') {
        frameCallbacks.delete(frameId);
      }
    });
    idleCallbacks.clear();
    global.requestIdleCallback = mockRequestIdle;
    global.cancelIdleCallback = mockCancelIdle;
    mockRequestIdle.mockImplementation((callback) => {
      const handle = idleCallbacks.size + 1;
      idleCallbacks.set(handle, () =>
        callback({ didTimeout: false, timeRemaining: () => 50 })
      );
      return handle;
    });
    mockCancelIdle.mockImplementation((handle) => {
      if (typeof handle === 'number') idleCallbacks.delete(handle);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.requestIdleCallback = originalIdle;
    global.cancelIdleCallback = originalCancelIdle;
  });

  function createScrollRef() {
    return {
      current: {
        scrollTo: jest.fn(),
      },
    } as unknown as RefObject<ScrollViewInstance | null>;
  }

  it('coalesces repeated calls into one deferred scroll with the latest y value', () => {
    const scrollViewRef = createScrollRef();
    const onScrolled = jest.fn();
    const { result } = renderHook(() =>
      useNextStepScroll(scrollViewRef, onScrolled)
    );

    result.current(100);
    result.current(220);

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    frameCallbacks.get(1)?.(0);
    expect(mockRequestIdle).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 500,
    });
    idleCallbacks.get(1)?.();

    expect(scrollViewRef.current?.scrollTo).toHaveBeenCalledWith({
      animated: true,
      y: 220 - SPACING.md,
    });
    expect(onScrolled).toHaveBeenCalledTimes(1);
  });

  it('cancels pending frame and idle callbacks on unmount', () => {
    const scrollViewRef = createScrollRef();
    const onScrolled = jest.fn();
    const { result, unmount } = renderHook(() =>
      useNextStepScroll(scrollViewRef, onScrolled)
    );

    result.current(100);
    frameCallbacks.get(1)?.(0);
    unmount();

    expect(cancelAnimationFrame).not.toHaveBeenCalled();
    expect(mockCancelIdle).toHaveBeenCalledWith(1);
    expect(scrollViewRef.current?.scrollTo).not.toHaveBeenCalled();
  });

  it('cancels a queued animation frame when unmounted before scheduling idle work', () => {
    const scrollViewRef = createScrollRef();
    const { result, unmount } = renderHook(() =>
      useNextStepScroll(scrollViewRef, jest.fn())
    );

    result.current(100);
    unmount();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(mockRequestIdle).not.toHaveBeenCalled();
    expect(scrollViewRef.current?.scrollTo).not.toHaveBeenCalled();
  });

  it('does not scroll below zero', () => {
    const scrollViewRef = createScrollRef();
    const { result } = renderHook(() =>
      useNextStepScroll(scrollViewRef, jest.fn())
    );
    // Use a value just below the top offset so the scroll target must clamp to 0.
    const testInput = SPACING.md - 1;

    result.current(testInput);
    frameCallbacks.get(1)?.(0);
    idleCallbacks.get(1)?.();

    expect(scrollViewRef.current?.scrollTo).toHaveBeenCalledWith({
      animated: true,
      y: 0,
    });
  });

  it('does not report a scroll when the scroll view is unavailable', () => {
    // Use a null ref directly to exercise the ref-unavailable edge case.
    const scrollViewRef = {
      current: null,
    } as RefObject<ScrollViewInstance | null>;
    const onScrolled = jest.fn();
    const { result } = renderHook(() =>
      useNextStepScroll(scrollViewRef, onScrolled)
    );

    result.current(100);
    frameCallbacks.get(1)?.(0);
    idleCallbacks.get(1)?.();

    expect(onScrolled).not.toHaveBeenCalled();
  });
  it('falls back to a cancellable timer when idle callbacks are unavailable', () => {
    jest.useFakeTimers();
    Object.defineProperty(global, 'requestIdleCallback', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    const scrollViewRef = createScrollRef();
    const { result } = renderHook(() =>
      useNextStepScroll(scrollViewRef, jest.fn())
    );
    result.current(100);
    frameCallbacks.get(1)?.(0);
    jest.runOnlyPendingTimers();
    expect(scrollViewRef.current?.scrollTo).toHaveBeenCalledTimes(1);
    result.current(200);
    frameCallbacks.get(2)?.(0);
    jest.runOnlyPendingTimers();
    expect(scrollViewRef.current?.scrollTo).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('cancels the fallback timer on unmount', () => {
    jest.useFakeTimers();
    Object.defineProperty(global, 'requestIdleCallback', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    const scrollViewRef = createScrollRef();
    const { result, unmount } = renderHook(() =>
      useNextStepScroll(scrollViewRef, jest.fn())
    );
    result.current(100);
    frameCallbacks.get(1)?.(0);
    unmount();
    jest.runOnlyPendingTimers();
    expect(scrollViewRef.current?.scrollTo).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
