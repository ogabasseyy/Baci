import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useDrawerMenuAnimation } from './use-drawer-menu-animation';

let mockTimingCallbacks: Array<(finished?: boolean) => void> = [];
jest.mock('react-native-reanimated', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    Easing: {
      cubic: (value: number) => value,
      in: (fn: (value: number) => number) => fn,
      out: (fn: (value: number) => number) => fn,
    },
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useSharedValue: (initialValue: number) => {
      const ref = React.useRef<{
        get: () => number;
        set: (next: number) => void;
        value: number;
      } | null>(null);
      if (!ref.current) {
        let currentValue = initialValue;
        ref.current = {
          get value() {
            return currentValue;
          },
          set value(nextValue: number) {
            currentValue = nextValue;
          },
          get: () => currentValue,
          set: (nextValue: number) => {
            currentValue = nextValue;
          },
        };
      }
      return ref.current;
    },
    withTiming: (
      toValue: number,
      _config?: unknown,
      callback?: (finished?: boolean) => void
    ) => {
      if (typeof callback === 'function') {
        mockTimingCallbacks.push(callback);
      }
      return toValue;
    },
  };
});

describe('useDrawerMenuAnimation', () => {
  const baseProps = {
    drawerWidth: 320,
    isOpen: false,
    setCovering: jest.fn(),
    setFullyOpen: jest.fn(),
  };

  beforeEach(() => {
    mockTimingCallbacks = [];
    jest.clearAllMocks();
  });

  it('latches coverage at open-start and full-open at open-complete', async () => {
    const { rerender } = renderHook(
      (props: typeof baseProps) => useDrawerMenuAnimation(props),
      { initialProps: baseProps }
    );
    mockTimingCallbacks.length = 0;

    rerender({ ...baseProps, isOpen: true });
    expect(baseProps.setCovering).toHaveBeenCalledWith(true);
    expect(baseProps.setFullyOpen).not.toHaveBeenCalled();

    await act(async () => {
      mockTimingCallbacks.at(-1)?.(true);
    });
    expect(baseProps.setFullyOpen).toHaveBeenCalledWith(true);
  });

  it('releases both latches only at close-complete', async () => {
    const { rerender } = renderHook(
      (props: typeof baseProps) => useDrawerMenuAnimation(props),
      { initialProps: { ...baseProps, isOpen: true } }
    );
    await act(async () => {
      mockTimingCallbacks.at(-1)?.(true);
    });
    jest.clearAllMocks();

    rerender({ ...baseProps, isOpen: false });
    expect(baseProps.setCovering).not.toHaveBeenCalledWith(false);
    expect(baseProps.setFullyOpen).not.toHaveBeenCalledWith(false);

    await act(async () => {
      mockTimingCallbacks.at(-1)?.(true);
    });
    expect(baseProps.setFullyOpen).toHaveBeenCalledWith(false);
    expect(baseProps.setCovering).toHaveBeenCalledWith(false);
  });

  it('ignores cancelled animation completions', async () => {
    const { rerender } = renderHook(
      (props: typeof baseProps) => useDrawerMenuAnimation(props),
      { initialProps: baseProps }
    );
    mockTimingCallbacks.length = 0;

    rerender({ ...baseProps, isOpen: true });
    await act(async () => {
      mockTimingCallbacks.at(-1)?.(false);
    });
    expect(baseProps.setFullyOpen).not.toHaveBeenCalled();

    rerender({ ...baseProps, isOpen: false });
    await act(async () => {
      mockTimingCallbacks.at(-1)?.(false);
    });
    expect(baseProps.setFullyOpen).not.toHaveBeenCalledWith(false);
    expect(baseProps.setCovering).not.toHaveBeenCalledWith(false);
  });
});
