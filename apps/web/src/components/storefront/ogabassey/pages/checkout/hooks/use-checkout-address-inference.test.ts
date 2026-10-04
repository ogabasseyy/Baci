import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCheckoutAddressInference } from './use-checkout-address-inference';

describe('useCheckoutAddressInference', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('writes only the latest inferred address after the debounce settles', () => {
    const setFields = vi.fn();
    const { result } = renderHook(() => useCheckoutAddressInference(setFields));
    act(() =>
      result.current.scheduleInferredLocationUpdate({
        city: 'Ikeja',
        state: 'Lagos',
      })
    );
    act(() => vi.advanceTimersByTime(400));
    act(() =>
      result.current.scheduleInferredLocationUpdate({
        city: 'Abuja',
        state: 'FCT',
      })
    );
    act(() => vi.advanceTimersByTime(499));
    expect(setFields).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(setFields).toHaveBeenCalledExactlyOnceWith({
      newAddressCity: 'Abuja',
      newAddressState: 'FCT',
    });
  });
  it('cancels a pending inference when an explicit address replaces it', () => {
    const setFields = vi.fn();
    const { result } = renderHook(() => useCheckoutAddressInference(setFields));
    act(() => {
      result.current.scheduleInferredLocationUpdate({
        city: 'Ikeja',
        state: 'Lagos',
      });
      result.current.clearInferredLocationDebounce();
      vi.runAllTimers();
    });
    expect(setFields).not.toHaveBeenCalled();
  });
  it('does not persist an inferred address after unmount', () => {
    const setFields = vi.fn();
    const { result, unmount } = renderHook(() =>
      useCheckoutAddressInference(setFields)
    );
    act(() =>
      result.current.scheduleInferredLocationUpdate({
        city: 'Ikeja',
        state: 'Lagos',
      })
    );
    unmount();
    act(() => vi.runAllTimers());
    expect(setFields).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
