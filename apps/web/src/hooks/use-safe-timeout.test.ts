import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSafeTimeout } from './use-safe-timeout';

describe('useSafeTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires the callback after the delay', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useSafeTimeout());

    act(() => {
      result.current(callback, 2000);
    });
    expect(callback).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('does not fire after unmount', () => {
    const callback = vi.fn();
    const { result, unmount } = renderHook(() => useSafeTimeout());

    act(() => {
      result.current(callback, 2000);
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(callback).not.toHaveBeenCalled();
  });
});
