import { renderHook } from '@testing-library/react-native';
import {
  calculateQuizServerClockOffset,
  useQuizServerClock,
} from './use-quiz-server-clock';

describe('quiz server clock', () => {
  it('calculates positive and negative device skew from serverNow', () => {
    expect(
      calculateQuizServerClockOffset(
        '2026-08-04T09:04:00.000Z',
        Date.parse('2026-08-04T09:03:55.000Z')
      )
    ).toBe(5000);
    expect(
      calculateQuizServerClockOffset(
        '2026-08-04T09:04:00.000Z',
        Date.parse('2026-08-04T09:04:03.000Z')
      )
    ).toBe(-3000);
  });

  it('exposes server time using one anchored observation', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-04T09:03:55.000Z'));
    const { result } = renderHook(() =>
      useQuizServerClock('2026-08-04T09:04:00.000Z')
    );
    expect(result.current.offsetMs).toBe(5000);
    expect(result.current.serverNowMs).toBe(
      Date.parse('2026-08-04T09:04:00.000Z')
    );
    jest.useRealTimers();
  });

  it('reanchors each new server snapshot when the next question arrives', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-04T09:04:00.000Z'));
    const { result, rerender } = renderHook(
      ({ serverNow }: { serverNow: string }) => useQuizServerClock(serverNow),
      {
        initialProps: { serverNow: '2026-08-04T09:04:00.000Z' },
      }
    );

    jest.advanceTimersByTime(10_000);
    rerender({ serverNow: '2026-08-04T09:04:10.000Z' });

    expect(result.current.offsetMs).toBe(0);
    expect(result.current.serverNowMs).toBe(
      Date.parse('2026-08-04T09:04:10.000Z')
    );
    jest.useRealTimers();
  });
});
