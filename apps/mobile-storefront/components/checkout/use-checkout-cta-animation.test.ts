import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import {
  cancelAnimation,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useCheckoutCtaAnimation } from './use-checkout-cta-animation';

const originalAppState = Object.getOwnPropertyDescriptor(
  AppState,
  'currentState'
);
let mockFocused = true;
jest.mock('expo-router/react-navigation', () => ({
  useIsFocused: () => mockFocused,
}));
jest.mock('react-native-reanimated', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    cancelAnimation: jest.fn(),
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useSharedValue: (initial: number) => {
      const value = React.useRef(initial);
      return React.useRef({
        get: () => value.current,
        set: (next: number) => {
          value.current = next;
        },
      }).current;
    },
    withRepeat: jest.fn((value: number) => value),
    withSequence: jest.fn((value: number) => value),
    withTiming: jest.fn((value: number) => value),
  };
});

describe('checkout CTA animation CPU lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFocused = true;
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (originalAppState)
      Object.defineProperty(AppState, 'currentState', originalAppState);
  });

  it('finishes its attention cue instead of scheduling an infinite frame loop', () => {
    renderHook(() => useCheckoutCtaAnimation(false));
    expect(withRepeat).toHaveBeenCalledWith(expect.anything(), 3, false);
  });

  it('cancels on navigation blur, resumes on focus, and cancels on unmount', () => {
    const { rerender, unmount } = renderHook(() =>
      useCheckoutCtaAnimation(false)
    );
    mockFocused = false;
    rerender({});
    expect(cancelAnimation).toHaveBeenCalled();
    expect(withRepeat).toHaveBeenCalledTimes(1);
    mockFocused = true;
    rerender({});
    expect(withRepeat).toHaveBeenCalledTimes(2);
    const cancellations = jest.mocked(cancelAnimation).mock.calls.length;
    unmount();
    expect(cancelAnimation).toHaveBeenCalledTimes(cancellations + 1);
  });

  it('stops when the app backgrounds and restarts only when active', () => {
    const remove = jest.fn();
    let onState: ((state: AppStateStatus) => void) | undefined;
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        onState = listener;
        return { remove };
      });
    const { unmount } = renderHook(() => useCheckoutCtaAnimation(false));
    act(() => onState?.('background'));
    expect(cancelAnimation).toHaveBeenCalled();
    expect(withRepeat).toHaveBeenCalledTimes(1);
    act(() => onState?.('active'));
    expect(withRepeat).toHaveBeenCalledTimes(2);
    unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('preserves the cart timing and resets the arrow when processing begins', () => {
    const { rerender } = renderHook(
      ({ processing }: { processing: boolean }) =>
        useCheckoutCtaAnimation(processing, 600),
      { initialProps: { processing: false } }
    );
    expect(withTiming).toHaveBeenCalledWith(6, { duration: 600 });
    expect(withTiming).toHaveBeenCalledWith(0, { duration: 600 });
    rerender({ processing: true });
    expect(cancelAnimation).toHaveBeenCalled();
    expect(jest.mocked(cancelAnimation).mock.calls.at(-1)?.[0].get()).toBe(0);
    expect(withRepeat).toHaveBeenCalledTimes(1);
  });

  it('does not animate while processing or initially covered', () => {
    const { rerender } = renderHook(
      ({ processing }: { processing: boolean }) =>
        useCheckoutCtaAnimation(processing),
      { initialProps: { processing: true } }
    );
    expect(withRepeat).not.toHaveBeenCalled();
    mockFocused = false;
    rerender({ processing: false });
    expect(withRepeat).not.toHaveBeenCalled();
  });
});
