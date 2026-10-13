import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { maybeShowQuizStartInterstitial } from '@/lib/quiz-start-interstitial';
import { useQuizWaitingRoom } from './use-quiz-waiting-room';
import { createDeferred, event } from './use-quiz-waiting-room-test-harness';

jest.mock('@/lib/quiz-start-interstitial', () => ({
  maybeShowQuizStartInterstitial: jest.fn(async () => 'skipped'),
}));

const mockMaybeShowQuizStartInterstitial = jest.mocked(
  maybeShowQuizStartInterstitial
);

describe('useQuizWaitingRoom interstitial ownership', () => {
  afterEach(() => {
    jest.useRealTimers();
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

  it('holds a start boundary that lands after presentation starts but before the helper resolves', async () => {
    // Regression: show() resolves over a native bridge round-trip after
    // presentation begins; ownership must be claimed synchronously via
    // onPresenting, otherwise a refresh completing in that window starts
    // timed play behind the presenting ad.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T11:59:00.000Z'));
    mockMaybeShowQuizStartInterstitial.mockClear();
    const interstitial = createDeferred<'shown' | 'skipped'>();
    mockMaybeShowQuizStartInterstitial.mockReturnValueOnce(
      interstitial.promise
    );
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
    const options = mockMaybeShowQuizStartInterstitial.mock.calls.at(-1)?.[0];
    expect(typeof options?.onPresenting).toBe('function');
    // Presentation begins (synchronous LOADED callback) while the helper
    // promise stays pending across the bridge round-trip.
    act(() => {
      options?.onPresenting?.();
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
    // The boundary landed while presenting but unresolved: held, not fired.
    expect(onStart).not.toHaveBeenCalled();
    await act(async () => {
      interstitial.resolve('shown');
      for (let flush = 0; flush < 10; flush += 1) {
        await Promise.resolve();
      }
    });
    expect(result.current.isFullscreenAdActive).toBe(true);
    await act(async () => {
      options?.onClosed?.();
      await Promise.resolve();
    });
    expect(onStart).toHaveBeenCalledWith('event-1', true);
    expect(result.current.isFullscreenAdActive).toBe(false);
  });
});
