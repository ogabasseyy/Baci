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

  it('does not keep an interval alive for an already expired inactive event', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    const { result } = renderHook(() =>
      useQuizEventTimer({
        eventEndsAt: '2026-08-04T09:03:00.000Z',
        isActive: false,
        onExpire: jest.fn(),
      })
    );

    expect(result.current).toEqual({ hasEnded: true, remainingSeconds: 0 });
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it('does not tick a future inactive event', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    renderHook(() =>
      useQuizEventTimer({
        eventEndsAt: '2026-08-04T09:05:00.000Z',
        isActive: false,
        onExpire: jest.fn(),
      })
    );

    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it('can tick an inactive timer when a pending result needs the countdown', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    renderHook(() =>
      useQuizEventTimer({
        eventEndsAt: '2026-08-04T09:05:00.000Z',
        isActive: false,
        onExpire: jest.fn(),
        shouldTick: true,
      })
    );

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    setIntervalSpy.mockRestore();
  });
});
