import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { useQuizStartHold } from './use-quiz-start-hold';

describe('useQuizStartHold', () => {
  it('flushes a held start when the covering flag clears', () => {
    const onStart = jest.fn();
    const refs = {
      appStateRef: { current: 'active' as const },
      isFullscreenAdActiveRef: { current: false },
      isStartBlockedRef: { current: true },
      onStartRef: { current: onStart },
      pendingStartRef: {
        current: { id: 'event-1' } as { id: string },
      },
      startedRef: { current: false },
      stoppedRef: { current: false },
    };
    const args = (isStartBlocked: boolean) =>
      ({
        ...refs,
        isStartBlocked,
      }) as unknown as Parameters<typeof useQuizStartHold>[0];

    const { rerender } = renderHook(
      (props: { isStartBlocked: boolean }) =>
        useQuizStartHold(args(props.isStartBlocked)),
      { initialProps: { isStartBlocked: true } }
    );
    expect(onStart).not.toHaveBeenCalled();

    rerender({ isStartBlocked: false });
    expect(onStart).toHaveBeenCalledWith('event-1', true);
    expect(refs.pendingStartRef.current).toBeNull();
  });

  it('keeps the hold while the interstitial still owns the screen', () => {
    const onStart = jest.fn();
    const refs = {
      appStateRef: { current: 'active' as const },
      isFullscreenAdActiveRef: { current: true },
      isStartBlockedRef: { current: true },
      onStartRef: { current: onStart },
      pendingStartRef: {
        current: { id: 'event-1' } as { id: string },
      },
      startedRef: { current: false },
      stoppedRef: { current: false },
    };
    const args = (isStartBlocked: boolean) =>
      ({
        ...refs,
        isStartBlocked,
      }) as unknown as Parameters<typeof useQuizStartHold>[0];

    const { rerender } = renderHook(
      (props: { isStartBlocked: boolean }) =>
        useQuizStartHold(args(props.isStartBlocked)),
      { initialProps: { isStartBlocked: true } }
    );
    rerender({ isStartBlocked: false });

    expect(onStart).not.toHaveBeenCalled();
    expect(refs.pendingStartRef.current).not.toBeNull();
  });
});
