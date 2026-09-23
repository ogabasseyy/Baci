import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDeliveryToday } from './use-delivery-today';

describe('useDeliveryToday', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes at the next Lagos midnight and cleans up its timer', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-10T22:30:00Z'));
    const { result, unmount } = renderHook(() => useDeliveryToday());

    expect(result.current).toEqual(new Date('2024-01-10T22:30:00Z'));
    act(() => vi.advanceTimersByTime(30 * 60 * 1000));
    expect(result.current).toEqual(new Date('2024-01-10T23:00:00Z'));

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
