import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useQuizAuthoringClock } from './use-quiz-authoring-clock';

describe('useQuizAuthoringClock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rerenders on the clock tick', () => {
    // Arrange: the hook returns a reticker, so observe rerenders through
    // a wall-clock reading captured per render.
    vi.useFakeTimers();
    const { result } = renderHook(() => {
      useQuizAuthoringClock();
      return Date.now();
    });
    const firstRenderMs = result.current;

    // Act
    act(() => {
      vi.advanceTimersByTime(16_000);
    });

    // Assert
    expect(result.current).toBeGreaterThan(firstRenderMs);
  });

  it('rerenders on demand', () => {
    // Arrange
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useQuizAuthoringClock();
    });

    // Act
    act(() => {
      result.current();
    });

    // Assert
    expect(renders).toBe(2);
  });
});
