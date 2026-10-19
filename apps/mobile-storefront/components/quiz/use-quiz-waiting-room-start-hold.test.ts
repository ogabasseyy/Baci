import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import {
  resetQuizFullscreenOwnershipForTests,
  setQuizRewardedFlowActive,
} from '@/lib/quiz-fullscreen-ownership';
import { maybeShowQuizStartInterstitial } from '@/lib/quiz-start-interstitial';
import { useQuizWaitingRoom } from './use-quiz-waiting-room';
import { event } from './use-quiz-waiting-room-test-harness';

jest.mock('@/lib/quiz-start-interstitial', () => ({
  maybeShowQuizStartInterstitial: jest.fn(async () => 'skipped'),
}));

const mockMaybeShowQuizStartInterstitial = jest.mocked(
  maybeShowQuizStartInterstitial
);

describe('useQuizWaitingRoom start hold', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('holds the start transition while a rewarded ad is open', async () => {
    // Regression: a start boundary landing across an open rewarded video
    // or end card must wait in the pending-start path (not start timed play
    // behind the full-screen ad) and flush when the rewarded ad closes.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T11:59:00.000Z'));
    mockMaybeShowQuizStartInterstitial.mockClear();
    mockMaybeShowQuizStartInterstitial.mockResolvedValueOnce('skipped');
    const onStart = jest.fn();
    const { rerender } = renderHook(
      ({ rewardedActive }: { rewardedActive: boolean }) =>
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
          isRewardedAdActive: rewardedActive,
        }),
      { initialProps: { rewardedActive: true } }
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
      rerender({ rewardedActive: false });
      for (let flush = 0; flush < 10; flush += 1) {
        await Promise.resolve();
      }
    });
    expect(onStart).toHaveBeenCalledWith('event-1', true);
  });

  it('holds the start transition while the rules modal is open', async () => {
    // Regression: a boundary landing across an open rules modal must wait
    // instead of starting timed play behind the native modal, and flush
    // after dismissal.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T11:59:00.000Z'));
    mockMaybeShowQuizStartInterstitial.mockClear();
    mockMaybeShowQuizStartInterstitial.mockResolvedValueOnce('skipped');
    const onStart = jest.fn();
    const { rerender } = renderHook(
      ({ suspended }: { suspended: boolean }) =>
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
          suspended,
        }),
      { initialProps: { suspended: true } }
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
      rerender({ suspended: false });
      for (let flush = 0; flush < 10; flush += 1) {
        await Promise.resolve();
      }
    });
    expect(onStart).toHaveBeenCalledWith('event-1', true);
  });

  it('holds a start boundary behind a synchronously claimed rewarded flow', async () => {
    // Regression: watchAd() claims rewarded ownership synchronously, but
    // the isRewardedAdActive prop arrives via a passive effect after the
    // tap; a refresh resolving in that window must still hold instead of
    // starting timed play behind the loading or presented rewarded ad.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T11:59:00.000Z'));
    resetQuizFullscreenOwnershipForTests();
    mockMaybeShowQuizStartInterstitial.mockClear();
    mockMaybeShowQuizStartInterstitial.mockResolvedValueOnce('skipped');
    const onStart = jest.fn();
    const { rerender } = renderHook(
      ({ rewardedActive }: { rewardedActive: boolean }) =>
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
          isRewardedAdActive: rewardedActive,
        }),
      { initialProps: { rewardedActive: false } }
    );
    // Synchronous tap: ownership claimed with no rerender yet, so the
    // hold prop is still stale-false when the boundary resolves.
    setQuizRewardedFlowActive(true);
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
    // The delayed prop follows the tap, then the close flushes the hold.
    // Separate acts: batching both transitions would swallow the
    // intermediate render whose effect arms the hold ref.
    setQuizRewardedFlowActive(false);
    await act(async () => {
      rerender({ rewardedActive: true });
    });
    await act(async () => {
      rerender({ rewardedActive: false });
      for (let flush = 0; flush < 10; flush += 1) {
        await Promise.resolve();
      }
    });
    expect(onStart).toHaveBeenCalledWith('event-1', true);
    resetQuizFullscreenOwnershipForTests();
  });
});
