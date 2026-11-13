import { act, renderHook } from '@testing-library/react-native';
import { MODAL_DISMISS_FALLBACK_MS } from '@/constants/modal-dismiss';
import { usePriceChangeDismissal } from './use-price-change-dismissal';

afterEach(() => {
  jest.useRealTimers();
});

it('releases the deferred repricing fence when the modal has no dismiss event', () => {
  jest.useFakeTimers();
  const { result, rerender } = renderHook(
    ({ visible }: { visible: boolean }) => usePriceChangeDismissal(visible),
    { initialProps: { visible: true } }
  );

  expect(result.current.isDismissed).toBe(false);
  rerender({ visible: false });
  expect(result.current.isDismissed).toBe(false);

  act(() => jest.advanceTimersByTime(MODAL_DISMISS_FALLBACK_MS - 1));
  expect(result.current.isDismissed).toBe(false);
  act(() => jest.advanceTimersByTime(1));
  expect(result.current.isDismissed).toBe(true);
});

it('cancels the fallback when repricing reappears before the close completes', () => {
  jest.useFakeTimers();
  const { result, rerender } = renderHook(
    ({ visible }: { visible: boolean }) => usePriceChangeDismissal(visible),
    { initialProps: { visible: true } }
  );

  rerender({ visible: false });
  rerender({ visible: true });
  act(() => jest.advanceTimersByTime(MODAL_DISMISS_FALLBACK_MS));

  expect(result.current.isDismissed).toBe(false);
});
