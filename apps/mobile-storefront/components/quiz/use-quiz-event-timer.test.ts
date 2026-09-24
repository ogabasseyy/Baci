import { act, renderHook } from '@testing-library/react-native';
import { useQuizEventTimer } from './use-quiz-event-timer';

describe('useQuizEventTimer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-04T09:04:00.000Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('shows the universal time left for a 9:04 late join and expires once at 9:05', () => {
    const onExpire = jest.fn();
    const { result } = renderHook(() =>
      useQuizEventTimer({
        eventEndsAt: '2026-08-04T09:05:00.000Z',
        isActive: true,
        onExpire,
      })
    );
    expect(result.current.remainingSeconds).toBe(60);
    act(() => jest.advanceTimersByTime(60_000));
    expect(result.current).toEqual({ hasEnded: true, remainingSeconds: 0 });
    expect(onExpire).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(1000));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('uses the shared server offset instead of extending from device time', () => {
    const { result } = renderHook(() =>
      useQuizEventTimer({
        eventEndsAt: '2026-08-04T09:05:00.000Z',
        isActive: true,
        onExpire: jest.fn(),
        serverClockOffsetMs: 5000,
      })
    );
    expect(result.current.remainingSeconds).toBe(55);
  });

  it('does not tick for inactive cards', () => {
    const onExpire = jest.fn();
    const { result } = renderHook(() =>
      useQuizEventTimer({
        eventEndsAt: '2026-08-04T09:05:00.000Z',
        isActive: false,
        onExpire,
      })
    );
    expect(result.current.remainingSeconds).toBe(60);
    act(() => jest.advanceTimersByTime(60_000));
    expect(result.current.remainingSeconds).toBe(60);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('ticks for inactive countdowns that opt into ticking', () => {
    const onExpire = jest.fn();
    const { result } = renderHook(() =>
      useQuizEventTimer({
        eventEndsAt: '2026-08-04T09:05:00.000Z',
        isActive: false,
        onExpire,
        ticking: true,
      })
    );
    act(() => jest.advanceTimersByTime(60_000));
    expect(result.current).toEqual({ hasEnded: true, remainingSeconds: 0 });
    expect(onExpire).not.toHaveBeenCalled();
  });
});
