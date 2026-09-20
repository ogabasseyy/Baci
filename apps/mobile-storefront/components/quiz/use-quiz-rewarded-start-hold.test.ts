import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { useQuizRewardedStartHold } from './use-quiz-rewarded-start-hold';

describe('useQuizRewardedStartHold', () => {
  it('flushes a held start when the rewarded ad closes', () => {
    const onStart = jest.fn();
    const refs = {
      appStateRef: { current: 'active' as const },
      isFullscreenAdActiveRef: { current: false },
      isRewardedAdActiveRef: { current: true },
      onStartRef: { current: onStart },
      pendingStartRef: {
        current: { id: 'event-1' } as { id: string },
      },
      startedRef: { current: false },
      stoppedRef: { current: false },
    };
    const args = (isRewardedAdActive: boolean) =>
      ({
        ...refs,
        isRewardedAdActive,
      }) as unknown as Parameters<typeof useQuizRewardedStartHold>[0];

    const { rerender } = renderHook(
      (props: { isRewardedAdActive: boolean }) =>
        useQuizRewardedStartHold(args(props.isRewardedAdActive)),
      { initialProps: { isRewardedAdActive: true } }
    );
    expect(onStart).not.toHaveBeenCalled();

    rerender({ isRewardedAdActive: false });
    expect(onStart).toHaveBeenCalledWith('event-1', true);
    expect(refs.pendingStartRef.current).toBeNull();
  });

  it('keeps the hold while the interstitial still owns the screen', () => {
    const onStart = jest.fn();
    const refs = {
      appStateRef: { current: 'active' as const },
      isFullscreenAdActiveRef: { current: true },
      isRewardedAdActiveRef: { current: true },
      onStartRef: { current: onStart },
      pendingStartRef: {
        current: { id: 'event-1' } as { id: string },
      },
      startedRef: { current: false },
      stoppedRef: { current: false },
    };
    const args = (isRewardedAdActive: boolean) =>
      ({
        ...refs,
        isRewardedAdActive,
      }) as unknown as Parameters<typeof useQuizRewardedStartHold>[0];

    const { rerender } = renderHook(
      (props: { isRewardedAdActive: boolean }) =>
        useQuizRewardedStartHold(args(props.isRewardedAdActive)),
      { initialProps: { isRewardedAdActive: true } }
    );
    rerender({ isRewardedAdActive: false });

    expect(onStart).not.toHaveBeenCalled();
    expect(refs.pendingStartRef.current).not.toBeNull();
  });
});
