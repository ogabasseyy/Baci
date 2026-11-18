import { jest } from '@jest/globals';

const mockUseColorScheme = jest.fn(() => 'light');
const mockUseCategories = jest.fn(() => ({
  data: [],
  error: null,
  isLoading: false,
}));
const mockUsePrefetchBillers = jest.fn();
const mockUseIsFocused = jest.fn(() => true);

jest.mock('react-native-reanimated', () => {
  const { View, Text } = jest.requireActual('react-native') as Record<
    string,
    unknown
  >;
  return {
    __esModule: true,
    default: { View, Text },
    View,
    Text,
    cancelAnimation: jest.fn(),
    useAnimatedStyle: (updater: () => object) => updater(),
    useSharedValue: (value: number) => ({
      value,
      get: () => value,
      set: jest.fn(),
    }),
    useAnimatedReaction: jest.fn(),
    runOnJS: (callback: (...args: unknown[]) => unknown) => callback,
    withTiming: (value: number) => value,
    withSpring: (value: number) => value,
  };
});

jest.mock('expo-router/react-navigation', () => ({
  useIsFocused: () => mockUseIsFocused(),
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => mockUseColorScheme(),
}));
jest.mock('@/hooks', () => ({ useCategories: () => mockUseCategories() }));
jest.mock('@/hooks/use-vtu-billers', () => ({
  usePrefetchBillers: () => mockUsePrefetchBillers(),
}));

import { act, render } from '@testing-library/react-native';
import { UtilityPanel } from './UtilityPanel';

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockUseColorScheme.mockReturnValue('light');
  mockUseIsFocused.mockReturnValue(true);
  mockUseCategories.mockReturnValue({
    data: [],
    error: null,
    isLoading: false,
  });
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('pauses auto-rotation during search and resumes when visible', () => {
  const interval = jest.spyOn(global, 'setInterval');
  const view = render(
    <UtilityPanel
      selectedCategoryId={null}
      onCategorySelect={jest.fn()}
      autoplayPaused
    />
  );
  expect(interval).not.toHaveBeenCalled();

  view.rerender(
    <UtilityPanel
      selectedCategoryId={null}
      onCategorySelect={jest.fn()}
      autoplayPaused={false}
    />
  );
  expect(interval).toHaveBeenCalledTimes(1);
});
