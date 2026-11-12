import { act, renderHook } from '@testing-library/react-native';
import {
  PIGGYVEST_SLOW_SIGNAL_TTL_MS,
  usePiggyvestSlowdownStore,
} from '@/stores/piggyvest-slowdown-store';
import {
  usePiggyvestSlowdown,
  useReportPiggyvestSlow,
} from './use-piggyvest-slowdown';

beforeEach(() => {
  jest.useFakeTimers();
  usePiggyvestSlowdownStore.setState({ signals: {} });
});
afterEach(() => jest.useRealTimers());

describe('usePiggyvestSlowdown with PiggyVest off', () => {
  it('stays calm when nothing reports slowness', () => {
    const { result } = renderHook(() => usePiggyvestSlowdown());
    expect(result.current).toBe(false);
  });

  it('turns on while a screen reports slow, and off when it recovers', () => {
    const reporter = renderHook(
      ({ slow }: { slow: boolean }) =>
        useReportPiggyvestSlow('goal-setup', slow),
      { initialProps: { slow: true } }
    );
    const { result } = renderHook(() => usePiggyvestSlowdown());
    expect(result.current).toBe(true);
    act(() => reporter.rerender({ slow: false }));
    expect(result.current).toBe(false);
  });

  it('goes away by itself once the signal runs out', async () => {
    act(() => usePiggyvestSlowdownStore.getState().markSlow('wallet-read'));
    const { result } = renderHook(() => usePiggyvestSlowdown());
    expect(result.current).toBe(true);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PIGGYVEST_SLOW_SIGNAL_TTL_MS + 5);
    });
    expect(result.current).toBe(false);
  });

  describe('bugfix: a long slowdown notice lapsed after five minutes', () => {
    it('stays on while the source is still slow', async () => {
      renderHook(() => useReportPiggyvestSlow('goal-setup', true));
      const { result } = renderHook(() => usePiggyvestSlowdown());
      await act(async () => {
        await jest.advanceTimersByTimeAsync(PIGGYVEST_SLOW_SIGNAL_TTL_MS * 3);
      });
      expect(result.current).toBe(true);
    });
  });
});
