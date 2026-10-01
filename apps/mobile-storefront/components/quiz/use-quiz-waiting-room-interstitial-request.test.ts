import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { maybeShowQuizStartInterstitial } from '@/lib/quiz-start-interstitial';
import type { QuizEvent } from '@/services/quiz-types';
import { useQuizWaitingRoom } from './use-quiz-waiting-room';
import { event } from './use-quiz-waiting-room-test-harness';

jest.mock('@/lib/quiz-start-interstitial', () => ({
  maybeShowQuizStartInterstitial: jest.fn(async () => 'skipped'),
}));

const mockMaybeShowQuizStartInterstitial = jest.mocked(
  maybeShowQuizStartInterstitial
);

describe('useQuizWaitingRoom interstitial request', () => {
  afterEach(() => {
    jest.useRealTimers();
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
});
