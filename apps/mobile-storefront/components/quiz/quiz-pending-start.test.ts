import { describe, expect, it, jest } from '@jest/globals';
import { flushPendingQuizStart } from './quiz-pending-start';

describe('flushPendingQuizStart', () => {
  it('takes a held start exactly once', () => {
    const onStart = jest.fn();
    const refs = {
      onStartRef: { current: onStart },
      pendingStartRef: {
        current: { id: 'event-1' } as { id: string },
      },
      startedRef: { current: false },
      stoppedRef: { current: false },
    };

    flushPendingQuizStart(
      refs as unknown as Parameters<typeof flushPendingQuizStart>[0]
    );
    expect(onStart).toHaveBeenCalledWith('event-1', true);
    expect(refs.pendingStartRef.current).toBeNull();
    expect(refs.startedRef.current).toBe(true);

    flushPendingQuizStart(
      refs as unknown as Parameters<typeof flushPendingQuizStart>[0]
    );
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('drops the hold without starting after stop', () => {
    const onStart = jest.fn();
    const refs = {
      onStartRef: { current: onStart },
      pendingStartRef: {
        current: { id: 'event-1' } as { id: string },
      },
      startedRef: { current: false },
      stoppedRef: { current: true },
    };

    flushPendingQuizStart(
      refs as unknown as Parameters<typeof flushPendingQuizStart>[0]
    );
    expect(onStart).not.toHaveBeenCalled();
    expect(refs.pendingStartRef.current).toBeNull();
  });
});
