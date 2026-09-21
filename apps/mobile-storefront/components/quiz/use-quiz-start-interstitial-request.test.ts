import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { MutableRefObject } from 'react';
import type { AppStateStatus } from 'react-native';
import { maybeShowQuizStartInterstitial } from '@/lib/quiz-start-interstitial';
import type { QuizEvent } from '@/services/quiz-types';
import { useQuizStartInterstitialRequest } from './use-quiz-start-interstitial-request';

jest.mock('@/lib/quiz-start-interstitial', () => ({
  maybeShowQuizStartInterstitial: jest.fn(async () => 'skipped'),
}));

const mockMaybeShowQuizStartInterstitial = jest.mocked(
  maybeShowQuizStartInterstitial
);

function ref<T>(current: T): MutableRefObject<T> {
  return { current };
}

type InterstitialOptions = NonNullable<
  Parameters<typeof maybeShowQuizStartInterstitial>[0]
>;

function setup(getRemainingSeconds = 60) {
  mockMaybeShowQuizStartInterstitial.mockClear();
  const refs = {
    appStateRef: ref<AppStateStatus>('active'),
    getRemainingSeconds: jest.fn(() => getRemainingSeconds),
    isFullscreenAdActiveRef: ref(false),
    isStartBlockedRef: ref(false),
    onStartRef: ref(jest.fn()),
    pendingStartRef: ref<QuizEvent | null>(null),
    setIsFullscreenAdActive: jest.fn(),
    startedRef: ref(false),
    stoppedRef: ref(false),
    suspendedRef: ref(false),
  };
  const utils = renderHook(() => useQuizStartInterstitialRequest({ ...refs }));
  const options = () =>
    mockMaybeShowQuizStartInterstitial.mock.calls.at(-1)?.[0] as
      | InterstitialOptions
      | undefined;
  return { ...utils, options, refs };
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    for (let flush = 0; flush < 10; flush += 1) {
      await Promise.resolve();
    }
  });
}

describe('useQuizStartInterstitialRequest', () => {
  it('requests the interstitial when more than 30 seconds remain', () => {
    setup(60);

    expect(mockMaybeShowQuizStartInterstitial).toHaveBeenCalledTimes(1);
  });

  it.each([
    30, 25,
  ])('skips the request when only %s seconds remain', (remaining) => {
    setup(remaining);

    expect(mockMaybeShowQuizStartInterstitial).not.toHaveBeenCalled();
  });

  it('cancels presentation after live play starts or the lobby stops', () => {
    const { options, refs } = setup();

    expect(options()?.isCancelled?.()).toBe(false);
    refs.startedRef.current = true;
    expect(options()?.isCancelled?.()).toBe(true);
    refs.startedRef.current = false;
    refs.stoppedRef.current = true;
    expect(options()?.isCancelled?.()).toBe(true);
  });

  it('cancels presentation while suspended or the app is inactive', () => {
    const { options, refs } = setup();

    refs.suspendedRef.current = true;
    expect(options()?.isCancelled?.()).toBe(true);
    refs.suspendedRef.current = false;
    refs.appStateRef.current = 'background';
    expect(options()?.isCancelled?.()).toBe(true);
    refs.appStateRef.current = 'inactive';
    expect(options()?.isCancelled?.()).toBe(true);
    refs.appStateRef.current = 'active';
    expect(options()?.isCancelled?.()).toBe(false);
  });

  it('cancels presentation once the countdown reaches the safety margin', () => {
    const { options, refs } = setup();
    refs.getRemainingSeconds.mockReturnValue(30);

    expect(options()?.isCancelled?.()).toBe(true);
  });

  it('claims ownership synchronously when presentation begins', () => {
    const { options, refs } = setup();

    act(() => {
      options()?.onPresenting?.();
    });

    expect(refs.isFullscreenAdActiveRef.current).toBe(true);
    expect(refs.setIsFullscreenAdActive).toHaveBeenCalledWith(true);
  });

  it('releases ownership and flushes a held start when the ad closes', () => {
    const { options, refs } = setup();
    refs.isFullscreenAdActiveRef.current = true;
    refs.pendingStartRef.current = { id: 'event-1' } as QuizEvent;

    act(() => {
      options()?.onClosed?.();
    });

    expect(refs.isFullscreenAdActiveRef.current).toBe(false);
    expect(refs.setIsFullscreenAdActive).toHaveBeenCalledWith(false);
    expect(refs.onStartRef.current).toHaveBeenCalledWith('event-1', true);
    expect(refs.pendingStartRef.current).toBeNull();
    expect(refs.startedRef.current).toBe(true);
  });

  it('retains a held start when the ad closes while covered', () => {
    const { options, refs } = setup();
    refs.pendingStartRef.current = { id: 'event-1' } as QuizEvent;
    refs.isStartBlockedRef.current = true;

    act(() => {
      options()?.onClosed?.();
    });

    expect(refs.pendingStartRef.current).not.toBeNull();
    expect(refs.onStartRef.current).not.toHaveBeenCalled();
  });

  it('claims ownership when the helper resolves shown', async () => {
    mockMaybeShowQuizStartInterstitial.mockResolvedValueOnce('shown');
    const { refs } = setup();
    await flushPromises();

    expect(refs.isFullscreenAdActiveRef.current).toBe(true);
    expect(refs.setIsFullscreenAdActive).toHaveBeenCalledWith(true);
  });

  it('releases a synchronously claimed withhold when presentation fails', async () => {
    mockMaybeShowQuizStartInterstitial.mockResolvedValueOnce('skipped');
    const { options, refs } = setup();
    act(() => {
      options()?.onPresenting?.();
    });
    refs.pendingStartRef.current = { id: 'event-1' } as QuizEvent;
    await flushPromises();

    // No CLOSED arrives for a failed presentation, so the failure path
    // both releases ownership and flushes the held boundary.
    expect(refs.isFullscreenAdActiveRef.current).toBe(false);
    expect(refs.onStartRef.current).toHaveBeenCalledWith('event-1', true);
  });

  it('ignores late callbacks after unmount', async () => {
    const { options, refs, unmount } = setup();
    unmount();

    expect(options()?.isCancelled?.()).toBe(true);
    act(() => {
      options()?.onClosed?.();
      options()?.onPresenting?.();
    });
    await flushPromises();

    expect(refs.isFullscreenAdActiveRef.current).toBe(false);
    expect(refs.setIsFullscreenAdActive).not.toHaveBeenCalled();
  });
});
