import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { maybeShowQuizStartInterstitial } from '@/lib/quiz-start-interstitial';
import type { QuizEvent } from '@/services/quiz-types';
import { useQuizWaitingRoom } from './use-quiz-waiting-room';

jest.mock('@/lib/quiz-start-interstitial', () => ({
  maybeShowQuizStartInterstitial: jest.fn(async () => 'skipped'),
}));

const mockMaybeShowQuizStartInterstitial = jest.mocked(
  maybeShowQuizStartInterstitial
);

const event = (overrides: Partial<QuizEvent> = {}): QuizEvent => ({
  endsAt: '2026-08-23T12:10:00.000Z',
  id: 'event-1',
  prizeName: 'Phone',
  questionCount: 10,
  startsAt: '2026-08-23T12:00:00.000Z',
  status: 'scheduled',
  title: 'Noon Quiz',
  serverNow: '2026-08-23T11:59:00.000Z',
  timePerQuestionSeconds: 10,
  ...overrides,
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('useQuizWaitingRoom', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses server offset for countdown and never starts from local time alone', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T12:00:30.000Z'));
    const refresh = jest.fn(async () => [event({ status: 'scheduled' })]);
    const onStart = jest.fn();
    const { result } = renderHook(() =>
      useQuizWaitingRoom({
        event: event(),
        onExit: jest.fn(),
        onStart,
        refresh,
      })
    );

    expect(result.current.remainingSeconds).toBe(60);
    await act(async () => {
      jest.advanceTimersByTime(61_000);
      await Promise.resolve();
    });
    expect(onStart).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it('starts once after refreshed event becomes active', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T11:59:59.000Z'));
    const refresh = jest
      .fn<() => Promise<QuizEvent[]>>()
      .mockResolvedValueOnce([
        event({
          serverNow: '2026-08-23T11:59:59.000Z',
          startsAt: '2026-08-23T12:00:00.000Z',
          status: 'active',
        }),
      ]);
    const onStart = jest.fn();
    const onEventsUpdated = jest.fn();
    const { result } = renderHook(() =>
      useQuizWaitingRoom({
        event: event({ serverNow: '2026-08-23T11:59:59.000Z' }),
        onEventsUpdated,
        onExit: jest.fn(),
        onStart,
        refresh,
      })
    );
    const listener = jest
      .mocked(AppState.addEventListener)
      .mock.calls.at(-1)?.[1] as (state: 'active') => void;

    await act(async () => {
      listener('active');
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    expect(onStart).toHaveBeenCalledWith('event-1', true);
    expect(onEventsUpdated).toHaveBeenCalledWith([
      expect.objectContaining({ status: 'active' }),
    ]);
    expect(onEventsUpdated.mock.invocationCallOrder[0]).toBeLessThan(
      onStart.mock.invocationCallOrder[0]
    );
    expect(result.current.event.status).toBe('active');
    await act(async () => {
      jest.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('refreshes on foreground and exits when event is terminal', async () => {
    const refresh = jest
      .fn<() => Promise<QuizEvent[]>>()
      .mockResolvedValue([event({ status: 'cancelled' })]);
    const onExit = jest.fn();
    renderHook(() =>
      useQuizWaitingRoom({
        event: event(),
        onExit,
        onStart: jest.fn(),
        refresh,
      })
    );
    const listener = jest
      .mocked(AppState.addEventListener)
      .mock.calls.at(-1)?.[1];
    expect(listener).toEqual(expect.any(Function));
    await act(async () => {
      (listener as (state: 'active') => void)('active');
      await Promise.resolve();
    });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('does not start an active response that resolves after backgrounding', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T11:59:59.000Z'));
    const first = createDeferred<QuizEvent[]>();
    const second = createDeferred<QuizEvent[]>();
    const refresh = jest
      .fn<() => Promise<QuizEvent[]>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const onStart = jest.fn();
    renderHook(() =>
      useQuizWaitingRoom({
        event: event({ serverNow: '2026-08-23T11:59:59.000Z' }),
        onExit: jest.fn(),
        onStart,
        refresh,
      })
    );
    const listener = jest
      .mocked(AppState.addEventListener)
      .mock.calls.at(-1)?.[1] as (state: 'active' | 'background') => void;

    await act(async () => {
      jest.advanceTimersByTime(2_000);
      listener('background');
      first.resolve([event({ status: 'active' })]);
      await Promise.resolve();
    });
    expect(onStart).not.toHaveBeenCalled();

    await act(async () => {
      listener('active');
      second.resolve([event({ status: 'active' })]);
      await Promise.resolve();
    });
    expect(onStart).toHaveBeenCalledWith('event-1', true);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('ignores stale R1 when R1 resolves after foreground starts R2', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T11:59:59.000Z'));
    const first = createDeferred<QuizEvent[]>();
    const second = createDeferred<QuizEvent[]>();
    const refresh = jest
      .fn<() => Promise<QuizEvent[]>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const onStart = jest.fn();
    renderHook(() =>
      useQuizWaitingRoom({
        event: event({ serverNow: '2026-08-23T11:59:59.000Z' }),
        onExit: jest.fn(),
        onStart,
        refresh,
      })
    );
    const listener = jest
      .mocked(AppState.addEventListener)
      .mock.calls.at(-1)?.[1] as (state: 'active' | 'background') => void;

    await act(async () => {
      jest.advanceTimersByTime(2_000);
      listener('background');
      listener('active');
      await Promise.resolve();
    });
    expect(refresh).toHaveBeenCalledTimes(2);

    await act(async () => {
      first.resolve([event({ status: 'active' })]);
      await Promise.resolve();
    });
    expect(onStart).not.toHaveBeenCalled();

    await act(async () => {
      second.resolve([event({ status: 'active' })]);
      await Promise.resolve();
    });
    expect(onStart).toHaveBeenCalledWith('event-1', true);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('shows the pre-quiz interstitial when the lobby opens with ample countdown', () => {
    mockMaybeShowQuizStartInterstitial.mockClear();
    renderHook(() =>
      useQuizWaitingRoom({
        event: event(),
        onExit: jest.fn(),
        onStart: jest.fn(),
        refresh: jest.fn(async () => []),
      })
    );
    expect(mockMaybeShowQuizStartInterstitial).toHaveBeenCalledTimes(1);
  });

  it('skips the pre-quiz interstitial when the quiz starts within 30 seconds', () => {
    mockMaybeShowQuizStartInterstitial.mockClear();
    renderHook(() =>
      useQuizWaitingRoom({
        event: event({ serverNow: '2026-08-23T11:59:50.000Z' }),
        onExit: jest.fn(),
        onStart: jest.fn(),
        refresh: jest.fn(async () => []),
      })
    );
    expect(mockMaybeShowQuizStartInterstitial).not.toHaveBeenCalled();
  });

  it('cancels the pending pre-quiz ad once live play begins', async () => {
    // Regression: a lobby that moves into the timed quiz while the
    // interstitial loads must abandon the presentation.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T11:59:00.000Z'));
    mockMaybeShowQuizStartInterstitial.mockClear();
    const refresh = jest
      .fn<() => Promise<QuizEvent[]>>()
      .mockResolvedValueOnce([
        event({
          serverNow: '2026-08-23T11:59:00.000Z',
          startsAt: '2026-08-23T12:00:00.000Z',
          status: 'active',
        }),
      ]);
    const onStart = jest.fn();
    renderHook(() =>
      useQuizWaitingRoom({
        event: event(),
        onExit: jest.fn(),
        onStart,
        refresh,
      })
    );
    expect(mockMaybeShowQuizStartInterstitial).toHaveBeenCalledTimes(1);
    const isCancelled =
      mockMaybeShowQuizStartInterstitial.mock.calls[0]?.[0]?.isCancelled;
    expect(typeof isCancelled).toBe('function');
    expect(isCancelled?.()).toBe(false);
    const listener = jest
      .mocked(AppState.addEventListener)
      .mock.calls.at(-1)?.[1] as (state: 'active') => void;
    await act(async () => {
      listener('active');
      await Promise.resolve();
    });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(isCancelled?.()).toBe(true);
  });

  it('cancels the pending pre-quiz ad while the lobby is suspended', async () => {
    // Regression: opening the rules modal while the interstitial loads must
    // abandon the presentation so no full-screen ad covers the rules; closing
    // the modal re-arms it.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T11:59:00.000Z'));
    mockMaybeShowQuizStartInterstitial.mockClear();
    const { rerender } = renderHook(
      ({ suspended }: { suspended: boolean }) =>
        useQuizWaitingRoom({
          event: event(),
          onExit: jest.fn(),
          onStart: jest.fn(),
          refresh: jest.fn(async () => []),
          suspended,
        }),
      { initialProps: { suspended: false } }
    );
    expect(mockMaybeShowQuizStartInterstitial).toHaveBeenCalledTimes(1);
    const isCancelled =
      mockMaybeShowQuizStartInterstitial.mock.calls[0]?.[0]?.isCancelled;
    expect(typeof isCancelled).toBe('function');
    expect(isCancelled?.()).toBe(false);
    rerender({ suspended: true });
    expect(isCancelled?.()).toBe(true);
    rerender({ suspended: false });
    expect(isCancelled?.()).toBe(false);
  });

  it('cancels the pending pre-quiz ad while the app is inactive', async () => {
    // Regression: backgrounding the app while the interstitial loads must
    // abandon the presentation so the ad cannot surface on resume over
    // whatever the shopper sees; foregrounding re-arms it.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T11:59:00.000Z'));
    mockMaybeShowQuizStartInterstitial.mockClear();
    // Foregrounding re-fetches: keep the scheduled event alive so only the
    // app-state predicate (not a vanished quiz) drives cancellation.
    const liveEvent = event();
    renderHook(() =>
      useQuizWaitingRoom({
        event: liveEvent,
        onExit: jest.fn(),
        onStart: jest.fn(),
        refresh: jest.fn(async () => [liveEvent]),
      })
    );
    expect(mockMaybeShowQuizStartInterstitial).toHaveBeenCalledTimes(1);
    const isCancelled =
      mockMaybeShowQuizStartInterstitial.mock.calls[0]?.[0]?.isCancelled;
    expect(typeof isCancelled).toBe('function');
    expect(isCancelled?.()).toBe(false);
    const listener = jest
      .mocked(AppState.addEventListener)
      .mock.calls.at(-1)?.[1] as (state: AppStateStatus) => void;
    await act(async () => {
      listener('background');
      await Promise.resolve();
    });
    expect(isCancelled?.()).toBe(true);
    await act(async () => {
      listener('active');
      await Promise.resolve();
    });
    expect(isCancelled?.()).toBe(false);
  });

  it('reports fullscreen ownership while the pre-quiz ad is presented', async () => {
    // Regression: the waiting-room banner must stay unmounted underneath a
    // presented interstitial, and remount once it closes.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T11:59:00.000Z'));
    mockMaybeShowQuizStartInterstitial.mockClear();
    mockMaybeShowQuizStartInterstitial.mockResolvedValueOnce('shown');
    const { result } = renderHook(() =>
      useQuizWaitingRoom({
        event: event(),
        onExit: jest.fn(),
        onStart: jest.fn(),
        refresh: jest.fn(async () => []),
      })
    );
    expect(result.current.isFullscreenAdActive).toBe(false);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isFullscreenAdActive).toBe(true);
    const onClosed =
      mockMaybeShowQuizStartInterstitial.mock.calls[0]?.[0]?.onClosed;
    expect(typeof onClosed).toBe('function');
    act(() => {
      onClosed?.();
    });
    expect(result.current.isFullscreenAdActive).toBe(false);
  });

  it('holds the start transition until a presented interstitial closes', async () => {
    // Regression: an interstitial that loads with just over 30 seconds left
    // must not let live play start behind it — the timed window would burn
    // under the full-screen ad. The boundary start waits for onClosed.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T11:59:00.000Z'));
    mockMaybeShowQuizStartInterstitial.mockClear();
    mockMaybeShowQuizStartInterstitial.mockResolvedValueOnce('shown');
    const onStart = jest.fn();
    const { result } = renderHook(() =>
      useQuizWaitingRoom({
        event: event(),
        onExit: jest.fn(),
        onStart,
        refresh: jest.fn(async () => [
          event({
            serverNow: '2026-08-23T12:00:01.000Z',
            status: 'active',
          }),
        ]),
      })
    );
    await act(async () => {
      for (let flush = 0; flush < 10; flush += 1) {
        await Promise.resolve();
      }
    });
    expect(result.current.isFullscreenAdActive).toBe(true);
    // The jest AppState starts non-active, which would mask the start
    // branch entirely: foreground like production before the boundary.
    const appStateListener = jest
      .mocked(AppState.addEventListener)
      .mock.calls.at(-1)?.[1] as (state: AppStateStatus) => void;
    await act(async () => {
      appStateListener('active');
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(61_000);
      for (let flush = 0; flush < 10; flush += 1) {
        await Promise.resolve();
      }
    });
    // Start boundary reached while the ad owns the screen: held, not fired.
    expect(onStart).not.toHaveBeenCalled();
    const onClosed =
      mockMaybeShowQuizStartInterstitial.mock.calls.at(-1)?.[0]?.onClosed;
    await act(async () => {
      onClosed?.();
      await Promise.resolve();
    });
    expect(onStart).toHaveBeenCalledWith('event-1', true);
    expect(result.current.isFullscreenAdActive).toBe(false);
  });

  it('retains a pending start when the interstitial closes while backgrounded', async () => {
    // Regression: a native dismissal while the app is inactive must not
    // start timed play in the background — the pending transition waits for
    // the foreground refresh to re-validate it on resume.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T11:59:00.000Z'));
    mockMaybeShowQuizStartInterstitial.mockClear();
    mockMaybeShowQuizStartInterstitial.mockResolvedValueOnce('shown');
    const onStart = jest.fn();
    renderHook(() =>
      useQuizWaitingRoom({
        event: event(),
        onExit: jest.fn(),
        onStart,
        refresh: jest.fn(async () => [
          event({
            serverNow: '2026-08-23T12:00:01.000Z',
            status: 'active',
          }),
        ]),
      })
    );
    await act(async () => {
      for (let flush = 0; flush < 10; flush += 1) {
        await Promise.resolve();
      }
    });
    const appStateListener = jest
      .mocked(AppState.addEventListener)
      .mock.calls.at(-1)?.[1] as (state: AppStateStatus) => void;
    await act(async () => {
      appStateListener('active');
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(61_000);
      for (let flush = 0; flush < 10; flush += 1) {
        await Promise.resolve();
      }
    });
    expect(onStart).not.toHaveBeenCalled();
    await act(async () => {
      appStateListener('background');
      await Promise.resolve();
    });
    const onClosed =
      mockMaybeShowQuizStartInterstitial.mock.calls.at(-1)?.[0]?.onClosed;
    await act(async () => {
      onClosed?.();
      await Promise.resolve();
    });
    expect(onStart).not.toHaveBeenCalled();
    await act(async () => {
      appStateListener('active');
      for (let flush = 0; flush < 10; flush += 1) {
        await Promise.resolve();
      }
    });
    expect(onStart).toHaveBeenCalledWith('event-1', true);
  });

  it('cancels the pending pre-quiz ad when the countdown expires before start', async () => {
    // Refresh latency must not reopen the late-ad defect: once the local
    // countdown reaches zero the loaded ad is abandoned even though the
    // authoritative refresh has not returned an active event yet. The
    // refreshed event carries a current server clock so the offset cannot
    // rewind the countdown.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T11:59:00.000Z'));
    mockMaybeShowQuizStartInterstitial.mockClear();
    renderHook(() =>
      useQuizWaitingRoom({
        event: event(),
        onExit: jest.fn(),
        onStart: jest.fn(),
        refresh: jest.fn(async () => [
          event({
            serverNow: '2026-08-23T12:00:01.000Z',
            status: 'scheduled',
          }),
        ]),
      })
    );
    expect(mockMaybeShowQuizStartInterstitial).toHaveBeenCalledTimes(1);
    const isCancelled =
      mockMaybeShowQuizStartInterstitial.mock.calls[0]?.[0]?.isCancelled;
    expect(isCancelled?.()).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(61_000);
      for (let flush = 0; flush < 10; flush += 1) {
        await Promise.resolve();
      }
    });
    expect(isCancelled?.()).toBe(true);
  });

  it('cancels the pending pre-quiz ad once the safety margin expires', async () => {
    // A load requested with 60 seconds left that is still pending with 25
    // seconds left must not present over the timed quiz: the same 30-second
    // threshold gates presentation, not just the initial request.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T11:59:00.000Z'));
    mockMaybeShowQuizStartInterstitial.mockClear();
    renderHook(() =>
      useQuizWaitingRoom({
        event: event(),
        onExit: jest.fn(),
        onStart: jest.fn(),
        refresh: jest.fn(async () => []),
      })
    );
    const isCancelled =
      mockMaybeShowQuizStartInterstitial.mock.calls[0]?.[0]?.isCancelled;
    expect(isCancelled?.()).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(35_000);
      for (let flush = 0; flush < 10; flush += 1) {
        await Promise.resolve();
      }
    });
    expect(isCancelled?.()).toBe(true);
  });

  it('cancels the pending pre-quiz ad at exactly the safety margin', async () => {
    // A displayed "30" can be as little as 29.001 real seconds while the
    // request required strictly more than 30, so presentation cancels at 30.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T11:59:00.000Z'));
    mockMaybeShowQuizStartInterstitial.mockClear();
    renderHook(() =>
      useQuizWaitingRoom({
        event: event(),
        onExit: jest.fn(),
        onStart: jest.fn(),
        refresh: jest.fn(async () => []),
      })
    );
    const isCancelled =
      mockMaybeShowQuizStartInterstitial.mock.calls[0]?.[0]?.isCancelled;
    expect(isCancelled?.()).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(30_000);
      for (let flush = 0; flush < 10; flush += 1) {
        await Promise.resolve();
      }
    });
    expect(isCancelled?.()).toBe(true);
  });

  it('cancels a pending active response when the waiting room unmounts', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T11:59:59.000Z'));
    const deferred = createDeferred<QuizEvent[]>();
    const onStart = jest.fn();
    const { unmount } = renderHook(() =>
      useQuizWaitingRoom({
        event: event({ serverNow: '2026-08-23T11:59:59.000Z' }),
        onExit: jest.fn(),
        onStart,
        refresh: jest.fn(() => deferred.promise),
      })
    );
    await act(async () => {
      jest.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    unmount();
    await act(async () => {
      deferred.resolve([event({ status: 'active' })]);
      await Promise.resolve();
    });
    expect(onStart).not.toHaveBeenCalled();
  });
});
