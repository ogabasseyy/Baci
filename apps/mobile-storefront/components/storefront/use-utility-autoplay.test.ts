import { act, renderHook } from '@testing-library/react-native';
import type { SharedValue } from 'react-native-reanimated';
import { useUtilityAutoplay } from './use-utility-autoplay';

jest.mock('react-native-reanimated', () => ({
  withTiming: (value: number) => value,
}));
function makeMutable(initial: number): SharedValue<number> {
  let current = initial;
  return {
    get value() {
      return current;
    },
    set value(value: number) {
      current = value;
    },
    get: () => current,
    set: (value) => {
      current = typeof value === 'function' ? value(current) : value;
    },
    addListener: jest.fn(),
    removeListener: jest.fn(),
    modify: (modifier) => {
      if (modifier) current = modifier(current);
    },
  };
}
let mockActive = true;
jest.mock('./use-app-active', () => ({ useAppActive: () => mockActive }));
beforeEach(() => {
  jest.useFakeTimers();
  mockActive = true;
});
afterEach(() => jest.useRealTimers());
it('advances, wraps, and cancels ticks when paused or unmounted', () => {
  const activeIndex = makeMutable(0);
  const options = {
    activeIndex,
    autoplayPaused: false,
    isFocused: true,
    isManual: false,
    itemCount: 2,
  };
  const { rerender, unmount } = renderHook(
    (props: Parameters<typeof useUtilityAutoplay>[0]) =>
      useUtilityAutoplay(props),
    { initialProps: options }
  );
  act(() => jest.advanceTimersByTime(2800));
  expect(activeIndex.get()).toBe(1);
  act(() => jest.advanceTimersByTime(2800));
  expect(activeIndex.get()).toBe(0);
  rerender({ ...options, autoplayPaused: true });
  act(() => jest.advanceTimersByTime(2800));
  expect(activeIndex.get()).toBe(0);
  rerender(options);
  unmount();
  act(() => jest.advanceTimersByTime(2800));
  expect(activeIndex.get()).toBe(0);
});
it.each([
  'manual',
  'focus',
  'background',
])('does not advance during %s', (reason) => {
  mockActive = reason !== 'background';
  const activeIndex = makeMutable(0);
  renderHook(() =>
    useUtilityAutoplay({
      activeIndex,
      autoplayPaused: false,
      isFocused: reason !== 'focus',
      isManual: reason === 'manual',
      itemCount: 2,
    })
  );
  act(() => jest.advanceTimersByTime(5600));
  expect(activeIndex.get()).toBe(0);
});
