import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addEventListener: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('react-native', () => ({
  AppState: { addEventListener: mocks.addEventListener },
}));

import { useCurrentDate } from './useCurrentDate';

describe('useCurrentDate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 8, 12, 0, 0));
    mocks.addEventListener.mockReturnValue({ remove: mocks.removeListener });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the current date', () => {
    const { result } = renderHook(() => useCurrentDate());

    expect(result.current).toEqual(new Date(2026, 9, 8, 12, 0, 0));
  });

  it('refreshes at local midnight', () => {
    const { result } = renderHook(() => useCurrentDate());

    act(() => {
      vi.advanceTimersByTime(12 * 60 * 60 * 1000);
    });

    expect(result.current).toEqual(new Date(2026, 9, 9, 0, 0, 0));
  });

  it('refreshes when the app becomes active', () => {
    const { result } = renderHook(() => useCurrentDate());
    const listener = mocks.addEventListener.mock.calls[0][1];
    expect(mocks.addEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function)
    );
    vi.setSystemTime(new Date(2026, 9, 8, 15, 30, 0));

    act(() => {
      listener('active');
    });

    expect(result.current).toEqual(new Date(2026, 9, 8, 15, 30, 0));
  });

  it('ignores background app-state changes', () => {
    const { result } = renderHook(() => useCurrentDate());
    const listener = mocks.addEventListener.mock.calls[0][1];
    vi.setSystemTime(new Date(2026, 9, 8, 15, 30, 0));

    act(() => {
      listener('background');
    });

    expect(result.current).toEqual(new Date(2026, 9, 8, 12, 0, 0));
  });

  it('clears the timer and listener on unmount', () => {
    const { unmount } = renderHook(() => useCurrentDate());
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(mocks.removeListener).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
