import { act, renderHook } from '@testing-library/react-native';
import { useHeroAutoplay } from './use-hero-autoplay';

let mockFocused = true;
let mockActive = true;
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));
jest.mock('./use-app-active', () => ({ useAppActive: () => mockActive }));
beforeEach(() => {
  jest.useFakeTimers();
  mockFocused = true;
  mockActive = true;
});
afterEach(() => jest.useRealTimers());
it('advances, wraps, and cancels pending ticks on pause and unmount', () => {
  const scrollToIndex = jest.fn();
  const options = {
    autoplayDelay: 100,
    autoplayPaused: false,
    currentIndex: 1,
    itemCount: 2,
    listRef: { current: { scrollToIndex } },
  };
  const { rerender, unmount } = renderHook(
    (props: Parameters<typeof useHeroAutoplay>[0]) => useHeroAutoplay(props),
    {
      initialProps: options,
    }
  );
  act(() => jest.advanceTimersByTime(100));
  expect(scrollToIndex).toHaveBeenLastCalledWith({ index: 0, animated: true });
  rerender({ ...options, autoplayPaused: true });
  act(() => jest.advanceTimersByTime(200));
  expect(scrollToIndex).toHaveBeenCalledTimes(1);
  rerender(options);
  unmount();
  act(() => jest.advanceTimersByTime(200));
  expect(scrollToIndex).toHaveBeenCalledTimes(1);
});
it.each([
  'focus',
  'background',
  'single',
])('does not schedule while %s blocks playback', (reason) => {
  mockFocused = reason !== 'focus';
  mockActive = reason !== 'background';
  const scrollToIndex = jest.fn();
  renderHook(() =>
    useHeroAutoplay({
      autoplayDelay: 100,
      autoplayPaused: false,
      currentIndex: 0,
      itemCount: reason === 'single' ? 1 : 2,
      listRef: { current: { scrollToIndex } },
    })
  );
  act(() => jest.advanceTimersByTime(500));
  expect(scrollToIndex).not.toHaveBeenCalled();
});
