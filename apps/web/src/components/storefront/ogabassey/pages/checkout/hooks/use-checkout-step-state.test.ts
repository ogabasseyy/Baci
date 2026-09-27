import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCheckoutStepState } from './use-checkout-step-state';

function options() {
  return {
    isHydrated: true,
    currentStep: 'payment' as const,
    completedSteps: { contact: true, delivery: true },
    setField: vi.fn(),
    setFields: vi.fn(),
  };
}

describe('useCheckoutStepState', () => {
  it('starts at contact before hydration, then restores persisted steps without focusing or writing', () => {
    const input = options();
    const { result, rerender } = renderHook(
      ({ isHydrated }) => useCheckoutStepState({ ...input, isHydrated }),
      { initialProps: { isHydrated: false } }
    );
    expect(result.current.currentStep).toBe('contact');
    expect(result.current.completedSteps).toEqual({
      contact: false,
      delivery: false,
    });
    rerender({ isHydrated: true });
    expect(result.current.currentStep).toBe('payment');
    expect(result.current.completedSteps).toEqual(input.completedSteps);
    expect(result.current.focusActiveStep).toBe(false);
    expect(input.setField).not.toHaveBeenCalled();
    expect(input.setFields).not.toHaveBeenCalled();
  });

  it.each([
    'contact',
    'delivery',
    'payment',
  ] as const)('persists navigation to %s and enables focus after an explicit transition', (step) => {
    const input = options();
    const { result } = renderHook(() => useCheckoutStepState(input));
    act(() => result.current.setCurrentStep(step));
    expect(input.setField).toHaveBeenCalledWith('currentStep', step);
    expect(result.current.focusActiveStep).toBe(true);
    expect(input.setFields).not.toHaveBeenCalled();
  });

  it('completes contact and advances delivery in a single persisted update, preserving delivery completion', () => {
    const input = {
      ...options(),
      completedSteps: { contact: false, delivery: true },
    };
    const { result } = renderHook(() => useCheckoutStepState(input));
    act(() => result.current.completeContact());
    expect(input.setFields).toHaveBeenCalledExactlyOnceWith({
      currentStep: 'delivery',
      completedSteps: { contact: true, delivery: true },
    });
    expect(input.setField).not.toHaveBeenCalled();
    expect(result.current.focusActiveStep).toBe(true);
    expect(input.completedSteps).toEqual({ contact: false, delivery: true });
  });

  it('supports explicit completion resets without changing navigation or focus', () => {
    const input = options();
    const { result } = renderHook(() => useCheckoutStepState(input));
    act(() =>
      result.current.setCompletedSteps({ contact: false, delivery: false })
    );
    expect(input.setField).toHaveBeenCalledExactlyOnceWith('completedSteps', {
      contact: false,
      delivery: false,
    });
    expect(result.current.currentStep).toBe('payment');
    expect(result.current.focusActiveStep).toBe(false);
  });

  it('evaluates functional completion updates against the latest rendered persisted state', () => {
    const input = options();
    const { result, rerender } = renderHook(
      ({ completedSteps }) =>
        useCheckoutStepState({ ...input, completedSteps }),
      { initialProps: { completedSteps: { contact: false, delivery: false } } }
    );
    rerender({ completedSteps: { contact: true, delivery: false } });
    act(() =>
      result.current.setCompletedSteps((previous) => ({
        ...previous,
        delivery: true,
      }))
    );
    expect(input.setField).toHaveBeenCalledWith('completedSteps', {
      contact: true,
      delivery: true,
    });
  });
});
