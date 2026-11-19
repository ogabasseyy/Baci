import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { QuizEvent } from '@/services/quiz-types';
import { useQuizWaitingRoom } from './use-quiz-waiting-room';
import { event } from './use-quiz-waiting-room-test-harness';

jest.mock('@/lib/quiz-start-interstitial', () => ({
  maybeShowQuizStartInterstitial: jest.fn(async () => 'skipped'),
}));

// The spy type is inferred from the call so it never has to be named.
const spyOnRandom = () => jest.spyOn(Math, 'random');

describe('useQuizWaitingRoom', () => {
  let randomSpy: ReturnType<typeof spyOnRandom>;

  beforeEach(() => {
    // Zero offset keeps the boundary refresh immediate for the legacy cases;
    // the timing cases below override it explicitly.
    randomSpy = spyOnRandom().mockReturnValue(0);
  });

  afterEach(() => {
    randomSpy.mockRestore();
    jest.useRealTimers();
  });

  describe('boundary refresh timing', () => {
    const renderAtCountdownZero = (refresh: () => Promise<QuizEvent[]>) => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-23T11:59:00.000Z'));
      return renderHook(() =>
        useQuizWaitingRoom({
          event: event(),
          onExit: jest.fn(),
          onStart: jest.fn(),
          refresh,
        })
      );
    };
    const advance = async (ms: number) => {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(ms);
      });
    };

    it('delays the first boundary refresh by a random offset', async () => {
      randomSpy.mockReturnValue(0.999);
      const refresh = jest
        .fn<() => Promise<QuizEvent[]>>()
        .mockResolvedValue([event({ serverNow: undefined })]);
      renderAtCountdownZero(refresh);

      // Offset is floor(0.999 * 3001) = 2997 ms, reached on the 3 s tick.
      await advance(60_000);
      expect(refresh).not.toHaveBeenCalled();
      await advance(2_750);
      expect(refresh).not.toHaveBeenCalled();
      await advance(250);
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('widens the gap to 1 s, 2 s, 4 s then 5 s while the quiz is still scheduled', async () => {
      randomSpy.mockReturnValue(0.5);
      const refresh = jest
        .fn<() => Promise<QuizEvent[]>>()
        .mockResolvedValue([event({ serverNow: undefined })]);
      renderAtCountdownZero(refresh);

      await advance(61_500);
      expect(refresh).toHaveBeenCalledTimes(1);
      // The server keeps answering "scheduled": 1 s, 2 s, 4 s, 5 s (cap), 5 s.
      let calls = 1;
      for (const gap of [1_000, 2_000, 4_000, 5_000, 5_000]) {
        await advance(gap - 1);
        expect(refresh).toHaveBeenCalledTimes(calls);
        await advance(1);
        calls += 1;
        expect(refresh).toHaveBeenCalledTimes(calls);
      }
    });

    it('refreshes at once when the random offset is zero', async () => {
      const refresh = jest
        .fn<() => Promise<QuizEvent[]>>()
        .mockResolvedValue([event({ serverNow: undefined })]);
      renderAtCountdownZero(refresh);

      await advance(60_000);
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('backs off 1 s, 2 s, 4 s then caps at 5 s after failed refreshes', async () => {
      randomSpy.mockReturnValue(0.5);
      const refresh = jest
        .fn<() => Promise<QuizEvent[]>>()
        .mockRejectedValue(new Error('offline'));
      renderAtCountdownZero(refresh);

      // Offset is floor(0.5 * 3001) = 1500 ms.
      await advance(61_499);
      expect(refresh).not.toHaveBeenCalled();
      await advance(1);
      expect(refresh).toHaveBeenCalledTimes(1);
      // Next gaps: 1 s, 2 s, 4 s, then 5 s (cap), 5 s.
      await advance(999);
      expect(refresh).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(refresh).toHaveBeenCalledTimes(2);
      await advance(1_999);
      expect(refresh).toHaveBeenCalledTimes(2);
      await advance(1);
      expect(refresh).toHaveBeenCalledTimes(3);
      await advance(3_999);
      expect(refresh).toHaveBeenCalledTimes(3);
      await advance(1);
      expect(refresh).toHaveBeenCalledTimes(4);
      await advance(4_999);
      expect(refresh).toHaveBeenCalledTimes(4);
      await advance(1);
      expect(refresh).toHaveBeenCalledTimes(5);
      await advance(4_999);
      expect(refresh).toHaveBeenCalledTimes(5);
      await advance(1);
      expect(refresh).toHaveBeenCalledTimes(6);
    });

    it('resets the backoff after a successful refresh that is not active yet', async () => {
      randomSpy.mockReturnValue(0.5);
      const refresh = jest
        .fn<() => Promise<QuizEvent[]>>()
        .mockRejectedValueOnce(new Error('offline'))
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue([event({ serverNow: undefined })]);
      renderAtCountdownZero(refresh);

      await advance(61_500); // call 1 fails
      await advance(1_000); // call 2 fails
      await advance(2_000); // call 3 succeeds (event still scheduled)
      expect(refresh).toHaveBeenCalledTimes(3);
      // Back to a 1 s gap, not the 4 s failure backoff.
      await advance(999);
      expect(refresh).toHaveBeenCalledTimes(3);
      await advance(1);
      expect(refresh).toHaveBeenCalledTimes(4);
    });

    it('draws a fresh offset when a moved start brings the countdown back to zero', async () => {
      const refresh = jest
        .fn<() => Promise<QuizEvent[]>>()
        .mockResolvedValue([
          event({ serverNow: undefined, startsAt: '2026-08-23T12:00:30.000Z' }),
        ]);
      renderAtCountdownZero(refresh);

      // First zero at 12:00:00 with a zero offset: refreshed at once, and the
      // start has moved 30 s.
      await advance(60_000);
      expect(refresh).toHaveBeenCalledTimes(1);
      // Second zero at 12:00:30 draws its own offset (about 3 s here), so it
      // neither fires at once nor repeats the first one.
      randomSpy.mockReturnValue(0.999);
      await advance(30_000 + 2_750);
      expect(refresh).toHaveBeenCalledTimes(1);
      await advance(250);
      expect(refresh).toHaveBeenCalledTimes(2);
    });

    it('waits 5 s before retrying when the server says it is overloaded', async () => {
      // Lowest spread: an ordinary first failure would retry after 0.8 s.
      const refresh = jest
        .fn<() => Promise<QuizEvent[]>>()
        .mockRejectedValueOnce(
          Object.assign(new Error('busy'), { status: 503 })
        )
        .mockResolvedValue([event({ serverNow: undefined })]);
      renderAtCountdownZero(refresh);

      await advance(60_000); // refresh at countdown zero fails with a 503
      expect(refresh).toHaveBeenCalledTimes(1);
      await advance(4_999);
      expect(refresh).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(refresh).toHaveBeenCalledTimes(2);
    });
  });
});
