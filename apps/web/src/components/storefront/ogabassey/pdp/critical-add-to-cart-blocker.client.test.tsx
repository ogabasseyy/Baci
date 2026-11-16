import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCriticalAddToCartBlocker } from './critical-add-to-cart-blocker.client';

const ready = {
  canAddToCart: true,
  maxQuantity: null,
  missingAxes: [],
  missingHiddenAxes: [],
  routeOfferMissingActive: false,
  visibleAxes: ['color'],
};

describe('useCriticalAddToCartBlocker', () => {
  it('submits the add when nothing blocks it', () => {
    const submitAddToCart = vi.fn();
    const { result } = renderHook(() =>
      useCriticalAddToCartBlocker({ ...ready, submitAddToCart })
    );

    act(() => result.current.handleAddToCart());

    expect(submitAddToCart).toHaveBeenCalledTimes(1);
    expect(result.current.addToCartBlocker).toBeNull();
    expect(result.current.addToCartBlockedAttempt).toBe(false);
  });

  it('records a blocked tap without submitting, and clears it again', () => {
    const submitAddToCart = vi.fn();
    const { result } = renderHook(() =>
      useCriticalAddToCartBlocker({
        ...ready,
        canAddToCart: false,
        missingAxes: ['color'],
        submitAddToCart,
      })
    );

    expect(result.current.addToCartBlocker?.kind).toBe('missing-selection');
    act(() => result.current.handleAddToCart());

    expect(submitAddToCart).not.toHaveBeenCalled();
    expect(result.current.addToCartBlockedAttempt).toBe(true);

    act(() => result.current.clearAddToCartBlockedAttempt());
    expect(result.current.addToCartBlockedAttempt).toBe(false);
  });
});
