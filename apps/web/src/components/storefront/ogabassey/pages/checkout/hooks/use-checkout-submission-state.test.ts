import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/hooks/use-toast';
import { captureCheckoutPaymentFailed } from '../capture-checkout-payment-failed';
import { useCheckoutSubmissionState } from './use-checkout-submission-state';

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('../capture-checkout-payment-failed', () => ({
  captureCheckoutPaymentFailed: vi.fn(),
}));
afterEach(() => vi.restoreAllMocks());

function setup() {
  const navigation = { setCurrentStep: vi.fn(), setCompletedSteps: vi.fn() };
  const hook = renderHook(() => useCheckoutSubmissionState(navigation));
  return { ...hook, ...navigation };
}
const payment = {
  paymentMethod: 'paystack',
  currency: 'NGN',
  orderNumber: '123',
  reference: 'reference',
};

describe('useCheckoutSubmissionState', () => {
  it('fences a second click synchronously before React rerenders', () => {
    const { result } = setup();
    expect(result.current.tryBeginSubmission(false)).toBe(true);
    expect(result.current.tryBeginSubmission(false)).toBe(false);
    // Validation can run under the lock without showing payment progress.
    expect(result.current.isProcessing).toBe(false);
  });
  it('does not acquire the fence when a payment is pending or held', () => {
    const { result } = setup();
    expect(result.current.tryBeginSubmission(true)).toBe(false);
    expect(result.current.isOrderInFlightRef.current).toBe(false);
    expect(result.current.tryBeginSubmission(false)).toBe(true);
  });
  it('clears processing and permits retry on provider return', () => {
    const { result } = setup();
    act(() => {
      result.current.tryBeginSubmission(false);
      result.current.setIsProcessing(true);
    });
    expect(result.current.isProcessing).toBe(true);
    act(() => result.current.releaseSubmission());
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.tryBeginSubmission(false)).toBe(true);
  });
  it('reports a started payment failure and preserves completed checkout steps', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, setCurrentStep, setCompletedSteps } = setup();
    act(() => {
      result.current.tryBeginSubmission(false);
      result.current.setIsProcessing(true);
    });
    act(() =>
      result.current.handleSubmissionError(
        new TypeError('Provider unavailable'),
        {
          createdOrderId: 'order',
          paymentStarted: true,
          payment,
        }
      )
    );
    expect(captureCheckoutPaymentFailed).toHaveBeenCalledWith({
      ...payment,
      orderId: 'order',
      reason: 'TypeError',
    });
    expect(toast).toHaveBeenCalledWith({
      title: 'Checkout Failed',
      description: 'Provider unavailable',
      variant: 'destructive',
    });
    expect(setCurrentStep).toHaveBeenCalledWith('payment');
    expect(setCompletedSteps).toHaveBeenCalledWith({
      contact: true,
      delivery: true,
    });
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.tryBeginSubmission(false)).toBe(true);
  });
  it.each([
    { createdOrderId: 'order', paymentStarted: false },
    { createdOrderId: undefined, paymentStarted: true },
  ])('does not attribute pre-payment failure: %j', (failure) => {
    vi.mocked(captureCheckoutPaymentFailed).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = setup();
    act(() =>
      result.current.handleSubmissionError(null, { ...failure, payment })
    );
    expect(captureCheckoutPaymentFailed).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      title: 'Checkout Failed',
      description: 'An error occurred. Please try again.',
      variant: 'destructive',
    });
  });
});
