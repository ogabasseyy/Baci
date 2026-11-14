import { jest } from '@jest/globals';

const mockWithTiming = jest.fn((toValue: number, _config?: object) => toValue);

jest.mock('react-native-reanimated', () => {
  const { View, Text } = jest.requireActual('react-native') as Record<
    string,
    unknown
  >;
  const ReactInline = jest.requireActual('react') as typeof import('react');

  return {
    __esModule: true,
    default: { View, Text },
    View,
    Text,
    cancelAnimation: jest.fn(),
    useAnimatedStyle: (updater: () => object) => updater(),
    useSharedValue: (initialValue: number) => {
      const valueRef = ReactInline.useRef(initialValue);
      const listenersRef = ReactInline.useRef<
        Array<(newValue: number, oldValue: number) => void>
      >([]);
      const listeners = listenersRef.current;
      const sharedValueRef = ReactInline.useRef<{
        readonly value: number;
        get: () => number;
        set: (newValue: number) => void;
        addListener: (
          listener: (newValue: number, oldValue: number) => void
        ) => () => void;
      } | null>(null);
      const assign = (newValue: number) => {
        const oldValue = valueRef.current;
        valueRef.current = newValue;
        for (const listener of listeners) {
          listener(newValue, oldValue);
        }
      };
      if (!sharedValueRef.current) {
        sharedValueRef.current = {
          get value() {
            return valueRef.current;
          },
          set value(newValue: number) {
            assign(newValue);
          },
          get() {
            return valueRef.current;
          },
          set(newValue: number) {
            assign(newValue);
          },
          addListener(listener) {
            listeners.push(listener);
            return () => {
              const index = listeners.indexOf(listener);
              if (index >= 0) listeners.splice(index, 1);
            };
          },
        };
      }
      return sharedValueRef.current;
    },
    useDerivedValue: (fn: () => number) => ({
      get value() {
        return fn();
      },
    }),
    useAnimatedReaction: (
      prepare: () => number,
      react: (nextIndex: number, prevIndex: number | null) => void,
      deps: unknown[]
    ) => {
      const lastValue = ReactInline.useRef(prepare());
      const shared = deps[0] as {
        addListener?: (
          cb: (newValue: number, oldValue: number) => void
        ) => (() => void) | undefined;
      };

      ReactInline.useEffect(() => {
        if (shared && typeof shared.addListener === 'function') {
          const listener = (newVal: number) => {
            const roundedVal = Math.round(newVal);
            if (roundedVal !== lastValue.current) {
              const oldVal = lastValue.current;
              lastValue.current = roundedVal;
              react(roundedVal, oldVal);
            }
          };
          return shared.addListener(listener);
        }
      }, [shared, react]);
    },
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
    withTiming: (
      toValue: number,
      config?: object,
      callback?: (isFinished?: boolean) => void
    ) => {
      mockWithTiming(toValue, config);
      callback?.(true);
      return toValue;
    },
    withSpring: (
      toValue: number,
      _config?: object,
      callback?: (isFinished?: boolean) => void
    ) => {
      callback?.(true);
      return toValue;
    },
  };
});

import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react-native';
import { useSharedValue } from 'react-native-reanimated';
import Colors from '@/constants/Colors';
import { findHostElement } from '@/test-support/find-host-element';
import { UtilityPanel } from './UtilityPanel';

type MockCategoriesResult = {
  data: unknown[];
  isLoading: boolean;
  error: Error | null;
};

const createCategoriesResult = (
  overrides: Partial<MockCategoriesResult> = {}
): MockCategoriesResult => ({
  data: [],
  isLoading: false,
  error: null,
  ...overrides,
});

const mockUseColorScheme = jest.fn(() => 'light');
const mockUseCategories = jest.fn<() => MockCategoriesResult>(() =>
  createCategoriesResult()
);
const mockUsePrefetchBillers = jest.fn();

const mockUseIsFocused = jest.fn(() => true);

jest.mock('expo-router/react-navigation', () => ({
  useIsFocused: () => mockUseIsFocused(),
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => mockUseColorScheme(),
}));

jest.mock('@/hooks', () => ({
  useCategories: () => mockUseCategories(),
}));

jest.mock('@/hooks/use-vtu-billers', () => ({
  usePrefetchBillers: () => mockUsePrefetchBillers(),
}));

describe('UtilityPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWithTiming.mockClear();
    jest.useFakeTimers();
    mockUseColorScheme.mockReturnValue('light');
    mockUseIsFocused.mockReturnValue(true);
    mockUseCategories.mockReturnValue(createCategoriesResult());
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('applies light and dark theme tokens to promo and selected icon backgrounds', () => {
    const onCategorySelect = jest.fn();

    const { rerender } = render(
      <UtilityPanel
        selectedCategoryId={null}
        onCategorySelect={onCategorySelect}
      />
    );

    expect(
      screen.getByLabelText('We Pay YOU When You Buy Airtime!')
    ).toHaveStyle({
      backgroundColor: Colors.light.promoBackground,
    });
    const airtimeButtonLight = screen.getByRole('button', { name: 'Airtime' });
    expect(findHostElement(airtimeButtonLight.children[0])).toHaveStyle({
      backgroundColor: Colors.light.card,
    });

    mockUseColorScheme.mockReturnValue('dark');

    rerender(
      <UtilityPanel selectedCategoryId={null} onCategorySelect={jest.fn()} />
    );

    expect(
      screen.getByLabelText('We Pay YOU When You Buy Airtime!')
    ).toHaveStyle({
      backgroundColor: Colors.dark.promoBackground,
    });
    const airtimeButtonDark = screen.getByRole('button', { name: 'Airtime' });
    expect(findHostElement(airtimeButtonDark.children[0])).toHaveStyle({
      backgroundColor: Colors.dark.card,
    });
  });

  it('renders an explicit error state for non-utility category failures', () => {
    mockUseCategories.mockReturnValue(
      createCategoriesResult({ error: new Error('boom') })
    );

    render(
      <UtilityPanel
        slug="phones"
        selectedCategoryId={null}
        onCategorySelect={jest.fn()}
      />
    );

    expect(screen.getByText('Unable to load categories')).toBeTruthy();
    expect(screen.getByText('Please try again in a moment.')).toBeTruthy();
  });

  it('auto-rotates promo words until a user manually selects a category', () => {
    const onCategorySelect = jest.fn();

    render(
      <UtilityPanel
        selectedCategoryId={null}
        onCategorySelect={onCategorySelect}
      />
    );

    expect(screen.getByText('Airtime!')).toBeTruthy();

    act(() => jest.advanceTimersByTime(2800));

    expect(screen.getByText('Data!')).toBeTruthy();

    act(() => jest.advanceTimersByTime(2800));

    expect(screen.getByText('Tv!')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Power'));
    expect(onCategorySelect).toHaveBeenCalledWith('u-power');
    expect(screen.getByText('Power!')).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(5600);
    });

    expect(screen.getByText('Power!')).toBeTruthy();
  });

  it('stops auto-rotation while a product screen covers home and resumes on return', () => {
    mockUseIsFocused.mockReturnValue(true);
    const { result } = renderHook(() => useSharedValue(0));
    const { rerender } = render(
      <UtilityPanel
        activeIndex={result.current}
        selectedCategoryId={null}
        onCategorySelect={jest.fn()}
      />
    );
    act(() => jest.advanceTimersByTime(2800));
    expect(screen.getByText('Data!')).toBeTruthy();
    mockUseIsFocused.mockReturnValue(false);
    rerender(
      <UtilityPanel
        activeIndex={result.current}
        selectedCategoryId={null}
        onCategorySelect={jest.fn()}
      />
    );
    act(() => jest.advanceTimersByTime(5600));
    expect(screen.getByText('Data!')).toBeTruthy();
    mockUseIsFocused.mockReturnValue(true);
    rerender(
      <UtilityPanel
        activeIndex={result.current}
        selectedCategoryId={null}
        onCategorySelect={jest.fn()}
      />
    );
    act(() => jest.advanceTimersByTime(2800));
    expect(screen.getByText('Tv!')).toBeTruthy();
  });
});
